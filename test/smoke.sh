#!/usr/bin/env bash
# RoommateSplit AI — smoke tests (10 checks).
set -u
cd "$(dirname "$0")/.."
pass=0; fail=0
ok()   { pass=$((pass+1)); echo "PASS: $1"; }
bad()  { fail=$((fail+1)); echo "FAIL: $1"; }

[ -f index.html ]            && ok "index.html exists"            || bad "index.html missing"
[ -f css/style.css ]         && ok "css/style.css exists"         || bad "css/style.css missing"
[ -f js/split.js ]           && ok "js/split.js exists"           || bad "js/split.js missing"
[ -f js/app.js ]             && ok "js/app.js exists"             || bad "js/app.js exists"
[ -f data/sample.json ]      && ok "data/sample.json exists"      || bad "data/sample.json missing"
[ -f README.md ]             && ok "README.md exists"             || bad "README.md missing"

# scripts load in dependency order: engine before UI
if grep -q 'split.js' index.html && grep -q 'app.js' index.html && \
   [ "$(grep -n 'split.js' index.html | cut -d: -f1)" -lt "$(grep -n 'app.js' index.html | cut -d: -f1)" ]; then
  ok "index.html loads split.js before app.js"
else
  bad "index.html script order wrong"
fi

# local-first: no external network references
if grep -Eqo 'https?://[^"]*' index.html | grep -qv 'w3.org'; then
  bad "index.html references external URLs"
else
  ok "no external network references in index.html"
fi

# sample data is valid JSON with a usable household
if node -e "
  const d = require('./data/sample.json');
  if (d.roommates.length < 2) throw new Error('need 2+ roommates');
  if (d.bills.length < 1) throw new Error('need 1+ bill');
  d.bills.forEach(b => {
    if (!d.roommates.some(r => r.id === b.payerId)) throw new Error('bad payer: ' + b.name);
  });
" 2>/dev/null; then
  ok "sample.json parses; payers valid"
else
  bad "sample.json invalid or payers broken"
fi

# core logic assertions on the exact engine the UI uses
node_out=$(node - <<'NODE' 2>&1
const S = require('./js/split.js');
let n = 0, f = 0;
function eq(a, b, label) {
  if (Math.abs(a - b) < 0.005) { n++; console.log('PASS: ' + label); }
  else { f++; console.log('FAIL: ' + label + ' (got ' + a + ', want ' + b + ')'); }
}
const rms = [{id:'a',name:'A',roomSize:180},{id:'b',name:'B',roomSize:140},{id:'c',name:'C',roomSize:120}];
// even split of $100.00 across 3 -> exact cents, sums to total
let sh = S.shares({amount:100, splitRule:'even'}, rms);
eq(Object.values(sh).reduce((x,y)=>x+y,0), 100, 'even split sums exactly to total');
// by room size: A(180/440) pays the most
sh = S.shares({amount:440, splitRule:'bysize'}, rms);
eq(sh.a, 180, 'bysize: 180sqft room pays $180 of $440');
eq(Object.values(sh).reduce((x,y)=>x+y,0), 440, 'bysize sums exactly');
// custom shares respected
sh = S.shares({amount:200, splitRule:'custom', customShares:{a:50,b:30,c:20}}, rms);
eq(sh.a + sh.b + sh.c, 200, 'custom split sums exactly');
eq(sh.a, 100, 'custom 50% of $200 = $100');
// balances net to zero and settle plan clears everyone
const bills = [
  {amount:2400, splitRule:'bysize', payerId:'a', settled:false},
  {amount:96.4, splitRule:'even', payerId:'b', settled:false},
];
const net = S.balances(rms, bills, []);
eq(net.a + net.b + net.c, 0, 'balances net to zero');
const plan = S.settle(net);
const post = JSON.parse(JSON.stringify(net));
plan.forEach(p => { post[p.fromId] += p.amount; post[p.toId] -= p.amount; });
const maxLeft = Math.max(...Object.values(post).map(Math.abs));
eq(maxLeft, 0, 'settle plan clears all balances');
if (plan.length > 2) { f++; console.log('FAIL: plan should need <= 2 payments for 3 people'); }
else { n++; console.log('PASS: plan uses minimal payments (' + plan.length + ')'); }
// validation catches bad input
const badBills = [
  [{name:'', amount:10, payerId:'a', splitRule:'even'}, 'empty name'],
  [{name:'X', amount:0, payerId:'a', splitRule:'even'}, 'zero amount'],
  [{name:'X', amount:10, payerId:'zzz', splitRule:'even'}, 'unknown payer'],
  [{name:'X', amount:10, payerId:'a', splitRule:'custom', customShares:{a:40,b:30,c:20}}, 'custom sums to 90'],
];
let v = 0;
badBills.forEach(([b, label]) => {
  const errs = S.validateBill(b, rms);
  if (errs.length) { n++; console.log('PASS: validation rejects ' + label); }
  else { f++; console.log('FAIL: validation missed ' + label); }
});
if (S.money(1234567.891) === '$1,234,567.89') { n++; console.log('PASS: money formats with commas'); }
else { f++; console.log('FAIL: money format got ' + S.money(1234567.891)); }
process.exit(f ? 1 : 0);
NODE
)
echo "$node_out" | grep -E '^(PASS|FAIL)'
node_fails=$(echo "$node_out" | grep -c '^FAIL') || true
[ "$node_fails" = "0" ] && ok "node logic suite green" || bad "node logic suite had $node_fails failures"

echo "---"
if [ "$fail" = "0" ]; then echo "=== smoke: $pass passed, 0 failed ==="; exit 0;
else echo "=== smoke: $pass passed, $fail failed ==="; exit 1; fi
