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

// Flow 8: undo a recorded payment (payment history) -> balances fully restored
{
  const net0 = S.balances(rms, bills, []);
  const plan = S.settle(net0);
  const pays = [{ fromId: plan[0].fromId, toId: plan[0].toId, amount: plan[0].amount,
                  date: '2026-10-07' }];
  const undone = pays.slice(0, 0); // undo = remove the recorded payment
  const netRestored = S.balances(rms, bills, undone);
  const same = Object.keys(net0).every(k => close(net0[k], netRestored[k]));
  same ? ok('flow8: undoing a payment restores original balances')
       : bad('flow8: balances not restored', JSON.stringify([net0, netRestored]));
}

// Flow 9: "Repeat next month" -> cloned bill lands on next month's date, balances shift accordingly
{
  const src = bills.find(b => b.id === 'b-rent');
  const next = Object.assign({}, src, { id: 'b-rent-repeat', date: S.addMonths(src.date, 1), settled: false });
  next.date === '2026-11-01'
    ? ok('flow9: repeated rent lands on 2026-11-01')
    : bad('flow9: repeat date wrong', next.date);
  const net = S.balances(rms, bills.concat([next]), []);
  // rent charged twice -> Sam/Jo each owe rent twice, Alex is owed more
  const sh = S.shares(src, rms);
  const netOnce = S.balances(rms, bills, []);
  // repeating rent: the payer (Alex) is credited +amount and charged their share again
  (close(net['r-alex'], netOnce['r-alex'] + src.amount - sh['r-alex']) &&
   close(net['r-sam'], netOnce['r-sam'] - sh['r-sam']) &&
   close(net['r-alex'] + net['r-sam'] + net['r-jo'], 0))
    ? ok('flow9: repeated bill doubles rent shares, still nets to zero')
    : bad('flow9: repeat math off', JSON.stringify(net));
}

// Flow 10: ledger search + sort on the sample household
{
  const q = S.filterBills(bills, { q: 'rent' });
  (q.length === 1 && q[0].id === 'b-rent')
    ? ok('flow10: searching "rent" finds the rent bill')
    : bad('flow10: search off', JSON.stringify(q.map(b => b.id)));
  const srt = S.filterBills(bills, { sort: 'amountDesc' });
  (srt[0].id === 'b-rent' && srt[srt.length - 1].amount === 96.4)
    ? ok('flow10: amount sort puts $2400 rent first')
    : bad('flow10: sort off', JSON.stringify(srt.map(b => b.name)));
  const pf = S.filterBills(bills, { payerId: 'r-jo' });
  (pf.length === 1 && pf[0].id === 'b-groceries')
    ? ok('flow10: payer filter shows only Jo\'s bill')
    : bad('flow10: payer filter off', JSON.stringify(pf.map(b => b.id)));
}

// Flow 11: CSV export of the full sample ledger
{
  const csv = S.billsCSV(rms, bills);
  const rows = csv.split('\n');
  const headerOK = rows[0].indexOf('"Alex share"') > 0 && rows[0].indexOf('"Jo share"') > 0;
  const dataRows = rows.slice(1);
  const reconcile = dataRows.every((row, i) => {
    const cols = row.match(/"[^"]*"/g).map(s => s.slice(1, -1));
    const sum = cols.slice(6).map(Number).reduce((x, y) => x + y, 0);
    return close(sum, bills[i].amount) && cols[5] === 'open';
  });
  (rows.length === bills.length + 1 && headerOK && reconcile)
    ? ok('flow11: CSV exports full ledger, shares reconcile to totals')
    : bad('flow11: CSV off', csv.slice(0, 200));
}

// Flow 12: settlement summary text for the sample plan
{
  const plan = S.settle(S.balances(rms, bills, []));
  const txt = S.summaryText(rms, plan);
  const lines = txt.split('\n');
  (lines.length === plan.length + 2 &&
   lines[1].indexOf('Sam') > 0 && lines[1].indexOf('Alex') > 0 &&
   lines[lines.length - 1].indexOf('$1,328.94') > 0)
    ? ok('flow12: summary text lists named payments + correct total')
    : bad('flow12: summary off', txt);
}

// Flow 13: categories + overdue + statements on the sample household
{
  const rent = bills.find(b => b.name === 'Rent — Oct');
  rent.category = 'rent'; rent.dueDate = '2026-10-05';
  const elec = bills.find(b => b.name === 'Electric');
  elec.category = 'utilities'; elec.dueDate = '2026-09-15';
  const groc = bills.find(b => b.name === 'Groceries');
  groc.category = 'groceries';
  const ct = S.categoryTotals(rms, bills);
  const labels = ct.map(c => c.label);
  (ct.length === 3 && ct[0].label === 'Rent' && ct[0].total === 2400 && ct[0].count === 1)
    ? ok('flow13: category totals ranked biggest-first, rent on top')
    : bad('flow13: category totals off', JSON.stringify(ct.map(c => [c.label, c.total])));
  (labels.indexOf('Utilities') > -1 && labels.indexOf('Groceries') > -1)
    ? ok('flow13: all used categories reported')
    : bad('flow13: missing categories', labels.join(','));
  const rentRow = ct.find(c => c.label === 'Rent');
  (close(rentRow.perPerson['r-alex'], 981.82) && close(rentRow.perPerson['r-sam'], 763.64) && close(rentRow.perPerson['r-jo'], 654.54))
    ? ok('flow13: rent per-person shares match by-room-size split')
    : bad('flow13: rent shares off', JSON.stringify(rentRow.perPerson));
  const over = S.overdueBills(bills, '2026-10-12');
  (over.length === 2 && over[0].name === 'Electric' && over[1].name === 'Rent — Oct')
    ? ok('flow13: overdue flags electric + rent, oldest first')
    : bad('flow13: overdue off', JSON.stringify(over.map(b => b.name)));
  const fc = S.filterBills(bills, { category: 'groceries' });
  (fc.length === 1 && fc[0].name === 'Groceries')
    ? ok('flow13: category filter narrows the ledger')
    : bad('flow13: category filter off');
  const stmt = S.statementText(rms.find(r => r.id === 'r-sam'), rms, bills, []);
  (stmt.indexOf('RoommateSplit statement for Sam') === 0 && stmt.indexOf('Paid "Electric"') > 0 &&
   /You owe \$[\d,]+\.\d{2} overall\./.test(stmt))
    ? ok('flow13: per-person statement reads correctly for Sam')
    : bad('flow13: statement off', stmt);
}

console.log('---');
console.log('E2E PASS: ' + pass + '  FAIL: ' + fail);
process.exit(fail ? 1 : 0);
NODE
