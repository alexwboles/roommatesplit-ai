# RoommateSplit AI — Redesign Audit (2026-10-13)

Competitors researched: **Splitwise** (balance summary "you owe / you are owed", simplified debts, per-person balances).

## Visual gaps vs competitors
1. Balances were text rows ("owes $X") — Splitwise visualizes who owes what with **balance bars** and a household-level summary.
2. No **"total unsettled"** hero — the single number the whole house cares about was never shown.

## Functional gaps vs competitors
1. No household summary: total unsettled, debtor/creditor counts.
2. No relative-magnitude visualization of balances.

## Redesign plan
- **Net banner** atop "Who owes whom": total unsettled, debtor/creditor counts, and a stacked bar of each debtor's share — grounded in a new pure, tested `householdSummary(net)` in split.js.
- **Per-row balance bars**: each roommate's row gets a magnitude bar (owes = red, owed = green) scaled to the largest balance.
- All existing features preserved: roommates (room-size splits), bill ledger (search/filter/sort/CSV), split rules, balances, settle plan, payment recording + history, reminders, recurring bills, categories.

## Concept (1 paragraph)
Keep the ledger identity (it already reads like a proper accounting book) but lead with the money like Splitwise: a "total unsettled" banner with a stacked debtor bar on top of the balances panel, and per-roommate magnitude bars — so the house sees at a glance who owes what and how much of the hole each person is.
