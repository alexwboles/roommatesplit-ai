# RoommateSplit AI

Split shared bills fairly and settle up with the fewest payments possible —
all in your browser, all your data stays on your device.

**100% local. No accounts, no API keys, no network calls.**

## What it does

- **Roommates** — add the people in your household, optionally with room sizes
- **Bills** — record who paid, how much, when, and how to split it:
  - **Even** — equal shares
  - **By room size** — proportional to bedroom square footage
  - **Custom %** — your own percentages (validated to total 100%)
- **Exact-cent math** — largest-remainder allocation, so shares always sum
  to the bill total with zero rounding drift
- **Running balances** — who owes whom, netted across all bills and payments
- **Smart settlement** — a greedy plan that clears everyone's debts with the
  minimum number of payments
- **Settle per person or all at once** — "Mark paid" on individual steps, or
  "Record all as paid" to clear the whole plan
- **Settle / reopen bills** — park bills you've already handled outside the household

## Getting started

Open `index.html` in any modern browser. Sample roommates and bills are
seeded on first run — delete them or add your own. Everything persists in
`localStorage` under the `rmsplit.*` keys.

## Design

- `js/split.js` — pure splitting/settlement engine (no DOM). Also loads in
  Node so tests can exercise the exact same logic the UI uses.
- `js/app.js` — UI: rendering, modals, validation, persistence.
- `data/sample.json` — example household matching the in-app seed data.

## Tests

```sh
bash test/smoke.sh   # 10 checks: files, syntax, no network calls, logic assertions
bash test/e2e.sh     # 7 flows: full user journeys from bill entry to settled-up
```

## Privacy

There is no backend and no analytics. Open the file, use it, close it —
your data never leaves the machine.
