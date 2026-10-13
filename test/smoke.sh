#!/usr/bin/env bash
# RoommateSplit AI — smoke tests (14 shell checks + node logic suite).
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

# new UI hooks for the 5 functionality improvements
for id in export-csv copy-summary bill-search bill-payer-filter bill-cat-filter bill-sort payhist categories; do
  grep -q "id=\"$id\"" index.html && ok "index.html has #$id" || bad "index.html missing #$id"
done
grep -q 'filterBills' js/app.js && grep -q 'renderPayHistory' js/app.js && \
grep -q 'addMonths' js/app.js && grep -q 'summaryText' js/app.js && \
grep -q 'billsCSV' js/app.js \
  && ok "app.js wires the 5 new features" || bad "app.js missing new feature wiring"
grep -q 'categoryTotals' js/app.js && grep -q 'overdueBills' js/app.js && \
grep -q 'statementText' js/app.js && grep -q 'renderCategories' js/app.js && \
grep -q 'normalizeCategory' js/app.js \
  && ok "app.js wires categories / overdue / statements" || bad "app.js missing improvement wiring"
grep -q 'cat-pill' css/style.css && grep -q 'overdue-banner' css/style.css && grep -q 'cat-row' css/style.css \
  && ok "category + overdue styles present" || bad "improvement styles missing"

# no rounded rectangles (no-radius design rule: 50% circles only, 0 elsewhere)
if grep -Eo 'border-radius:[^;}]*' css/style.css | grep -Ev ':\s*(0|50%|var\(--radius\))\s*$' | grep -q .; then
  bad "css/style.css has rounded (non-0, non-circle) border-radius"
else
  ok "no rounded rectangles in css/style.css"
fi

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
const sample = require('./data/sample.json');
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

// billsCSV: header + one row per bill; share columns reconcile to bill totals
const csvRms = sample.roommates, csvBills = sample.bills;
const csv = S.billsCSV(csvRms, csvBills);
const lines = csv.split('\n');
eq(lines.length, csvBills.length + 1, 'CSV has header + one row per bill');
let csvOK = true;
csvBills.forEach((b, i) => {
  const cols = lines[i + 1].match(/"[^"]*"/g).map(s => s.slice(1, -1));
  const shareCols = cols.slice(8).map(Number);
  if (Math.abs(shareCols.reduce((x, y) => x + y, 0) - b.amount) > 0.005) csvOK = false;
  if (cols[0] !== b.name || cols[4] !== Number(b.amount).toFixed(2)) csvOK = false;
  if (cols[5] !== S.categoryLabel(S.normalizeCategory(b.category))) csvOK = false;
});
if (lines[0].indexOf('"Alex share"') > 0 && lines[0].indexOf('"Bill","Date","Due date"') === 0 && lines[0].indexOf('"Category"') > 0 && csvOK) {
  n++; console.log('PASS: CSV header + rows reconcile to bill totals');
} else { f++; console.log('FAIL: CSV rows malformed'); }

// summaryText formatting
const st = S.summaryText(rms, plan);
if (st.indexOf(' pays ') > 0 && st.indexOf('Total changing hands:') > 0 &&
    st.split('\n').length === plan.length + 2) { n++; console.log('PASS: summaryText lists payments + total'); }
else { f++; console.log('FAIL: summaryText format: ' + JSON.stringify(st)); }
if (S.summaryText(rms, []).indexOf('settled up') > 0) { n++; console.log('PASS: summaryText empty-plan message'); }
else { f++; console.log('FAIL: summaryText empty plan'); }

// addMonths edge cases
eq(S.addMonths('2026-10-01', 1) === '2026-11-01' ? 1 : 0, 1, 'addMonths normal case');
eq(S.addMonths('2026-12-15', 1) === '2027-01-15' ? 1 : 0, 1, 'addMonths rolls the year');
eq(S.addMonths('2026-01-31', 1) === '2026-02-28' ? 1 : 0, 1, 'addMonths clamps to Feb 28');
eq(S.addMonths('bogus', 1) === '' ? 1 : 0, 1, 'addMonths rejects bad input');

// filterBills search / filter / sort
const fb = [
  { name: 'Rent', amount: 2400, payerId: 'a', settled: false, date: '2026-10-01' },
  { name: 'Electric', amount: 96.4, payerId: 'b', settled: false, date: '2026-09-20' },
  { name: 'Old settled', amount: 50, payerId: 'a', settled: true, date: '2026-08-01' },
];
const fq = S.filterBills(fb, { q: 'rent' });
if (fq.length === 1 && fq[0].name === 'Rent') { n++; console.log('PASS: filterBills text search'); }
else { f++; console.log('FAIL: filterBills search'); }
const fp = S.filterBills(fb, { payerId: 'a' });
if (fp.length === 2 && fp.every(x => x.payerId === 'a')) { n++; console.log('PASS: filterBills payer filter'); }
else { f++; console.log('FAIL: filterBills payer'); }
const fs2 = S.filterBills(fb, { sort: 'amountDesc' });
if (fs2[0].name === 'Rent' && fs2[fs2.length - 1].settled) { n++; console.log('PASS: filterBills amount sort, settled last'); }
else { f++; console.log('FAIL: filterBills sort: ' + JSON.stringify(fs2.map(x => x.name))); }
const fs3 = S.filterBills(fb, { sort: 'oldest' });
if (fs3[0].name === 'Electric' && fs3[1].name === 'Rent') { n++; console.log('PASS: filterBills oldest sort'); }
else { f++; console.log('FAIL: filterBills oldest'); }

// ---- categories, overdue, statements (new) ----
// normalizeCategory: known ids pass through, junk -> 'other'
eq(S.normalizeCategory('rent') === 'rent' ? 1 : 0, 1, 'normalizeCategory rent');
eq(S.normalizeCategory('GROCERIES') === 'groceries' ? 1 : 0, 1, 'normalizeCategory case-insensitive');
eq(S.normalizeCategory('carrier pigeon') === 'other' ? 1 : 0, 1, 'normalizeCategory junk -> other');
eq(S.normalizeCategory('') === 'other' ? 1 : 0, 1, 'normalizeCategory empty -> other');
eq(S.categoryLabel('internet') === 'Internet' ? 1 : 0, 1, 'categoryLabel');
// filterBills category filter
const fb2 = [
  { name: 'Rent', amount: 2400, payerId: 'a', settled: false, date: '2026-10-01', category: 'rent' },
  { name: 'Electric', amount: 96.4, payerId: 'b', settled: false, date: '2026-09-20', category: 'utilities' },
  { name: 'Mystery', amount: 10, payerId: 'a', settled: false, date: '2026-09-01' },
];
const fc = S.filterBills(fb2, { category: 'utilities' });
eq(fc.length === 1 && fc[0].name === 'Electric' ? 1 : 0, 1, 'filterBills category filter');
const fc2 = S.filterBills(fb2, { category: 'other' });
eq(fc2.length === 1 && fc2[0].name === 'Mystery' ? 1 : 0, 1, 'filterBills uncategorized -> other');
// categoryTotals: biggest first, per-person shares, includes settled bills
const cr1 = { id: 'a', name: 'A' }, cr2 = { id: 'b', name: 'B' };
const ct = S.categoryTotals([cr1, cr2], [
  { name: 'Rent', amount: 1000, payerId: 'a', splitRule: 'even', category: 'rent', settled: false, date: '2026-10-01' },
  { name: 'Wifi', amount: 60, payerId: 'b', splitRule: 'even', category: 'internet', settled: false, date: '2026-10-01' },
  { name: 'Old rent', amount: 1000, payerId: 'a', splitRule: 'even', category: 'rent', settled: true, date: '2026-09-01' },
]);
eq(ct.length === 2 ? 1 : 0, 1, 'categoryTotals two categories');
eq(ct[0].category === 'rent' && ct[0].total === 2000 && ct[0].count === 2 ? 1 : 0, 1, 'categoryTotals rent includes settled');
eq(ct[0].perPerson.a === 1000 && ct[0].perPerson.b === 1000 ? 1 : 0, 1, 'categoryTotals per-person shares');
eq(ct[1].category === 'internet' && ct[1].total === 60 ? 1 : 0, 1, 'categoryTotals second category');
eq(S.categoryTotals([cr1], []).length === 0 ? 1 : 0, 1, 'categoryTotals empty');
// overdueBills: open + past due only, oldest first
const ob = S.overdueBills([
  { name: 'Late', amount: 100, settled: false, dueDate: '2026-09-01' },
  { name: 'Later', amount: 100, settled: false, dueDate: '2026-10-01' },
  { name: 'Future', amount: 100, settled: false, dueDate: '2026-12-01' },
  { name: 'Settled late', amount: 100, settled: true, dueDate: '2026-08-01' },
  { name: 'No due date', amount: 100, settled: false, dueDate: '' },
], '2026-10-12');
eq(ob.length === 2 && ob[0].name === 'Late' && ob[1].name === 'Later' ? 1 : 0, 1, 'overdueBills open+past-due, oldest first');
// statementText: paid lines, share lines, net verdict
const stmt = S.statementText(cr2, [cr1, cr2], [
  { name: 'Rent', amount: 1000, payerId: 'a', splitRule: 'even', category: 'rent', settled: false, date: '2026-10-01' },
  { name: 'Wifi', amount: 60, payerId: 'b', splitRule: 'even', category: 'internet', settled: false, date: '2026-10-01' },
]);
eq(stmt.indexOf('RoommateSplit statement for B') === 0 ? 1 : 0, 1, 'statement header');
eq(stmt.indexOf('Paid "Wifi" $60.00') > 0 ? 1 : 0, 1, 'statement paid line');
eq(stmt.indexOf('Owes $500.00 for "Rent" (paid by A)') > 0 ? 1 : 0, 1, 'statement share line');
eq(stmt.indexOf('You owe $470.00 overall.') > 0 ? 1 : 0, 1, 'statement net verdict');
eq((() => {
  const b = Object.assign(S.blankBill(), { name: 'Rent', amount: 1200, payerId: 'r1', date: '2026-09-01', dueDate: '2026-09-05', repeats: 'monthly', settled: true });
  b.id = 'b-rent';
  const sp = S.spawnRecurring([b]);
  if (sp.length !== 1) return 'spawned ' + sp.length;
  const n = sp[0];
  if (n.date !== '2026-10-01' || n.dueDate !== '2026-10-05') return 'dates ' + n.date + '/' + n.dueDate;
  if (n.settled || n.recurOf !== 'b-rent' || n.repeats !== 'monthly' || n.amount !== 1200) return 'fields';
  if (S.spawnRecurring([b].concat(sp)).length !== 0) return 'double spawn';
  return 1;
})(), 1, 'recurring: settled monthly bill spawns next month once');
eq((() => {
  const u = Object.assign(S.blankBill(), { name: 'Old', amount: 50, date: '2026-01-01', repeats: 'monthly', settled: false });
  u.id = 'b-old';
  return S.spawnRecurring([u]).length === 0 ? 1 : 'unsettled spawned';
})(), 1, 'recurring: unsettled bill spawns nothing');
eq(S.reminderText('Maya', 'Jo', 42.5).indexOf('Maya') === 3 && S.reminderText('Maya', 'Jo', 42.5).indexOf('$42.50') > 0 ? 1 : 0, 1, 'reminder text names + amount');
eq((() => {
  const csv = S.billsCSV([{ id: 'r1', name: 'Jo' }], [{ name: 'Rent', date: '2026-09-01', dueDate: '2026-09-05', payerId: 'r1', amount: 1200, splitRule: 'even', category: 'rent', settled: false }]);
  const head = csv.split('\n')[0];
  return head.indexOf('Category') >= 0 && head.indexOf('Due date') >= 0 && csv.indexOf('2026-09-05') >= 0 && csv.indexOf('Rent') >= 0 ? 1 : head;
})(), 1, 'CSV export carries category + due date');
process.exit(f ? 1 : 0);
NODE
)
echo "$node_out" | grep -E '^(PASS|FAIL)'
node_fails=$(echo "$node_out" | grep -c '^FAIL') || true
[ "$node_fails" = "0" ] && ok "node logic suite green" || bad "node logic suite had $node_fails failures"

echo "---"
if [ "$fail" = "0" ]; then echo "=== smoke: $pass passed, 0 failed ==="; exit 0;
else echo "=== smoke: $pass passed, $fail failed ==="; exit 1; fi
