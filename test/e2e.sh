#!/usr/bin/env bash
# RoommateSplit AI — end-to-end flows (7) against the real engine.
set -u
cd "$(dirname "$0")/.."
node - <<'NODE'
const S = require('./js/split.js');
const sample = require('./data/sample.json');
let pass = 0, fail = 0;
function ok(l) { pass++; console.log('PASS: ' + l); }
function bad(l, d) { fail++; console.log('FAIL: ' + l + (d ? ' — ' + d : '')); }
function close(a, b) { return Math.abs(a - b) < 0.01; }
const rms = sample.roommates, bills = sample.bills;
const byId = id => rms.find(r => r.id === id).name;

// Flow 1: load sample household -> expected balances, expected 2-payment plan
{
  const net = S.balances(rms, bills, []);
  const want = { 'r-alex': 1328.94, 'r-sam': -749.33, 'r-jo': -579.61 };
  const good = Object.keys(want).every(k => close(net[k], want[k]));
  good ? ok('flow1: sample balances match expected values')
       : bad('flow1: balances off', JSON.stringify(net));
  const plan = S.settle(net);
  const wantPlan = [
    { fromId: 'r-sam', toId: 'r-alex', amount: 749.33 },
    { fromId: 'r-jo', toId: 'r-alex', amount: 579.61 },
  ];
  const pg = plan.length === 2 && plan.every((p, i) =>
    p.fromId === wantPlan[i].fromId && p.toId === wantPlan[i].toId && close(p.amount, wantPlan[i].amount));
  pg ? ok('flow1: settlement plan is the expected 2 payments')
     : bad('flow1: plan off', JSON.stringify(plan));
}

// Flow 2: user adds a new bill -> balances + plan update, still fully clearable
{
  const b2 = bills.concat([{ amount: 60, splitRule: 'even', payerId: 'r-sam', settled: false }]);
  const net = S.balances(rms, b2, []);
  close(net['r-alex'] + net['r-sam'] + net['r-jo'], 0)
    ? ok('flow2: balances still net zero after new bill')
    : bad('flow2: balances drifted');
  const plan = S.settle(net);
  const post = Object.assign({}, net);
  plan.forEach(p => { post[p.fromId] += p.amount; post[p.toId] -= p.amount; });
  Math.max(...Object.values(post).map(Math.abs)) < 0.01
    ? ok('flow2: new-bill plan clears everyone')
    : bad('flow2: plan leaves debt', JSON.stringify(post));
}

// Flow 3: "Mark paid" on one step -> that step disappears from the plan
{
  const net = S.balances(rms, bills, []);
  const plan = S.settle(net);
  const pays = [{ fromId: plan[0].fromId, toId: plan[0].toId, amount: plan[0].amount }];
  const net2 = S.balances(rms, bills, pays);
  const plan2 = S.settle(net2);
  plan2.length === plan.length - 1
    ? ok('flow3: marking one payment paid removes it from the plan')
    : bad('flow3: plan length ' + plan.length + ' -> ' + plan2.length);
}

// Flow 4: "Record all as paid" -> plan becomes empty
{
  const net = S.balances(rms, bills, []);
  const plan = S.settle(net);
  const pays = plan.map(p => ({ fromId: p.fromId, toId: p.toId, amount: p.amount }));
  S.settle(S.balances(rms, bills, pays)).length === 0
    ? ok('flow4: recording all payments settles everything up')
    : bad('flow4: plan not empty after recording all');
}

// Flow 5: settle a bill -> excluded from balances; reopen -> back in
{
  const settled = bills.map(b => Object.assign({}, b, { settled: b.id === 'b-rent' }));
  const net = S.balances(rms, settled, []);
  // without rent: Alex paid nothing rent-wise, still owes rent/grocery shares -> should owe
  (net['r-alex'] < 0 && close(net['r-sam'] + net['r-jo'] + net['r-alex'], 0))
    ? ok('flow5: settled bill drops out of balances')
    : bad('flow5: settled bill still counted', JSON.stringify(net));
  close(S.balances(rms, bills, [])['r-alex'], 1328.94)
    ? ok('flow5: reopening the bill restores balances')
    : bad('flow5: reopen failed');
}

// Flow 6: custom % shares always reconcile to the bill total
{
  const b = bills.find(x => x.id === 'b-groceries');
  const sh = S.shares(b, rms);
  const sum = Object.values(sh).reduce((x, y) => x + y, 0);
  close(sum, 142.75) && close(sh['r-alex'], 57.10) && close(sh['r-sam'], 49.96) && close(sh['r-jo'], 35.69)
    ? ok('flow6: custom 40/35/25 splits $142.75 exactly')
    : bad('flow6: custom split off', JSON.stringify(sh));
}

// Flow 7: remove a roommate (and their bills) -> remaining balances stay consistent
{
  const keep = rms.filter(r => r.id !== 'r-jo');
  const keepBills = bills.filter(b => b.payerId !== 'r-jo' && b.name !== 'Groceries');
  const net = S.balances(keep, keepBills, []);
  (Object.keys(net).length === 2 && close(net['r-alex'] + net['r-sam'], 0))
    ? ok('flow7: removing a roommate keeps balances consistent')
    : bad('flow7: inconsistent', JSON.stringify(net));
}

console.log('---');
console.log('E2E PASS: ' + pass + '  FAIL: ' + fail);
process.exit(fail ? 1 : 0);
NODE
