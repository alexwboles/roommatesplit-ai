/* RoommateSplit AI — bill splitting + settlement engine.
 * Pure logic, no DOM. Works in the browser (window.RoommateSplit)
 * and in node (module.exports) so tests can require() it. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.RoommateSplit = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SPLIT_RULES = [
    { id: 'even', label: 'Split evenly' },
    { id: 'bysize', label: 'By room size' },
    { id: 'custom', label: 'Custom %' }
  ];

  function num(v, d) {
    v = parseFloat(v);
    return isNaN(v) ? d : v;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function money(n) {
    n = round2(num(n, 0));
    var parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + parts.join('.');
  }

  function uid(prefix) {
    return (prefix || 'r') + Date.now().toString(36) +
      Math.floor(Math.random() * 1296).toString(36);
  }

  function blankRoommate() {
  return { id: uid('r'), name: '', roomSize: 0 };
  }

  function blankBill() {
    return {
      id: uid('b'), name: '', amount: 0, payerId: '',
      splitRule: 'even', customShares: {}, // roommateId -> percent
      date: new Date().toISOString().slice(0, 10),
      dueDate: '',
      category: 'other',
      settled: false
    };
  }

  function validateRoommate(r) {
    var errs = [];
    if (!r.name || !String(r.name).trim()) errs.push('Roommate name is required.');
    if (num(r.roomSize, 0) < 0) errs.push('Room size cannot be negative.');
    return errs;
  }

  function validateBill(b, roommates) {
    var errs = [];
    if (!b.name || !String(b.name).trim()) errs.push('Bill name is required.');
    if (num(b.amount, 0) <= 0) errs.push('Bill amount must be greater than 0.');
    if (!b.payerId) errs.push('Choose who paid the bill.');
    else if (!roommates.some(function (r) { return r.id === b.payerId; }))
      errs.push('Payer is not in the roommate list.');
    if (b.splitRule === 'custom') {
      var sum = 0, n = 0;
      roommates.forEach(function (r) {
        var p = num(b.customShares[r.id], 0);
        if (p < 0) errs.push('Custom share for ' + r.name + ' cannot be negative.');
        if (p > 0) n++;
        sum += p;
      });
      if (n === 0) errs.push('Custom split needs at least one non-zero share.');
      else if (Math.abs(sum - 100) > 0.01)
        errs.push('Custom shares must add up to 100% (now ' + round2(sum) + '%).');
    }
    return errs;
  }

  /* Per-roommate share of one bill. Returns { roommateId: amount } in cents-exact. */
  function shares(bill, roommates) {
    var out = {};
    if (!roommates.length) return out;
    var totalCents = Math.round(num(bill.amount, 0) * 100);
    var raw = roommates.map(function (r) { return { id: r.id, w: 0 }; });

    if (bill.splitRule === 'bysize') {
      var sizeSum = 0;
      roommates.forEach(function (r) { sizeSum += Math.max(0, num(r.roomSize, 0)); });
      if (sizeSum > 0) {
        roommates.forEach(function (r, i) { raw[i].w = Math.max(0, num(r.roomSize, 0)) / sizeSum; });
      } else {
        raw.forEach(function (x) { x.w = 1 / roommates.length; });
      }
    } else if (bill.splitRule === 'custom') {
      var pctSum = 0;
      roommates.forEach(function (r, i) {
        var p = Math.max(0, num(bill.customShares[r.id], 0));
        raw[i].w = p; pctSum += p;
      });
      if (pctSum > 0) raw.forEach(function (x) { x.w = x.w / pctSum; });
      else raw.forEach(function (x) { x.w = 1 / roommates.length; });
    } else {
      raw.forEach(function (x) { x.w = 1 / roommates.length; });
    }

    // largest-remainder: exact cent split, no drift
    var assigned = 0;
    var parts = raw.map(function (x) {
      var exact = totalCents * x.w;
      var fl = Math.floor(exact);
      assigned += fl;
      return { id: x.id, fl: fl, rem: exact - fl };
    });
    var left = totalCents - assigned;
    parts.sort(function (a, b) { return b.rem - a.rem; });
    for (var i = 0; i < left; i++) parts[i % parts.length].fl += 1;
    parts.forEach(function (p) { out[p.id] = p.fl / 100; });
    return out;
  }

  /* Net balances across bills + recorded payments.
   * net > 0: others owe this person. net < 0: this person owes.
   * payments: [{ fromId, toId, amount }] — money already changing hands. */
  function balances(roommates, bills, payments) {
    var net = {};
    roommates.forEach(function (r) { net[r.id] = 0; });
    bills.forEach(function (b) {
      if (b.settled) return;
      var sh = shares(b, roommates);
      net[b.payerId] = round2(num(net[b.payerId], 0) + num(b.amount, 0));
      Object.keys(sh).forEach(function (id) {
        if (net[id] === undefined) net[id] = 0;
        net[id] = round2(net[id] - sh[id]);
      });
    });
    (payments || []).forEach(function (p) {
      var a = round2(num(p.amount, 0));
      if (net[p.fromId] === undefined || net[p.toId] === undefined) return;
      net[p.fromId] = round2(net[p.fromId] + a);
      net[p.toId] = round2(net[p.toId] - a);
    });
    // scrub float dust
    Object.keys(net).forEach(function (id) {
      if (Math.abs(net[id]) < 0.005) net[id] = 0;
    });
    return net;
  }

  /* Greedy minimum-transaction settlement: debtors pay creditors.
   * Returns [{ fromId, toId, amount }]. */
  function settle(net) {
    var debtors = [], creditors = [];
    Object.keys(net).forEach(function (id) {
      var v = round2(num(net[id], 0));
      if (v < -0.004) debtors.push({ id: id, amt: -v });
      else if (v > 0.004) creditors.push({ id: id, amt: v });
    });
    debtors.sort(function (a, b) { return b.amt - a.amt; });
    creditors.sort(function (a, b) { return b.amt - a.amt; });
    var plan = [];
    var i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      var d = debtors[i], c = creditors[j];
      var x = round2(Math.min(d.amt, c.amt));
      if (x > 0.004) plan.push({ fromId: d.id, toId: c.id, amount: x });
      d.amt = round2(d.amt - x);
      c.amt = round2(c.amt - x);
      if (d.amt < 0.005) i++;
      if (c.amt < 0.005) j++;
    }
    return plan;
  }

  function totalOwedTo(net, id) { return Math.max(0, round2(num(net[id], 0))); }
  function totalOwes(net, id) { return Math.max(0, round2(-num(net[id], 0))); }

  function csvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  /* Export the bill ledger as CSV: header + one row per bill with
   * per-roommate exact shares. Pure — used by the UI download button
   * and exercised directly by the tests. */
  function billsCSV(roommates, bills) {
    var header = ['Bill', 'Date', 'Payer', 'Amount', 'Split rule', 'Status'];
    roommates.forEach(function (r) { header.push(r.name + ' share'); });
    var lines = [header.map(csvCell).join(',')];
    (bills || []).forEach(function (b) {
      var sh = shares(b, roommates);
      var payer = '';
      roommates.forEach(function (r) { if (r.id === b.payerId) payer = r.name; });
      var rule = b.splitRule === 'bysize' ? 'by room size'
        : (b.splitRule === 'custom' ? 'custom %' : 'even');
      var row = [b.name, b.date || '', payer,
                 round2(num(b.amount, 0)).toFixed(2), rule,
                 b.settled ? 'settled' : 'open'];
      roommates.forEach(function (r) {
        row.push(round2(num(sh[r.id], 0)).toFixed(2));
      });
      lines.push(row.map(csvCell).join(','));
    });
    return lines.join('\n');
  }

  /* Plain-text settlement summary for sharing in chat/email/messaging.
   * Pure — used by the copy-summary button and exercised by tests. */
  function summaryText(roommates, plan) {
    if (!plan || !plan.length)
      return 'RoommateSplit: everyone is settled up. Nothing is owed.';
    var nm = {};
    roommates.forEach(function (r) { nm[r.id] = r.name; });
    var lines = ['RoommateSplit settlement plan:'];
    var total = 0;
    plan.forEach(function (p, i) {
      lines.push((i + 1) + '. ' + (nm[p.fromId] || 'Someone') + ' pays ' +
        (nm[p.toId] || 'Someone') + ' ' + money(p.amount));
      total = round2(total + num(p.amount, 0));
    });
    lines.push('Total changing hands: ' + money(total));
    return lines.join('\n');
  }

  /* Add n months to a YYYY-MM-DD date, clamping to the last day of the
   * target month (so Jan 31 -> Feb 28). Returns '' for bad input. */
  function addMonths(dateStr, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return '';
    var y = +m[1], mo = (+m[2] - 1) + (n | 0), d = +m[3];
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    var last = new Date(y, mo + 1, 0).getDate();
    d = Math.min(d, last);
    function p2(x) { return String(x).padStart(2, '0'); }
    return y + '-' + p2(mo + 1) + '-' + p2(d);
  }

  /* Filter + sort the bill ledger. opts: { q, payerId, category, sort }.
   * sort: 'newest' (default) | 'oldest' | 'amountDesc' | 'amountAsc' | 'name'.
   * Unsettled bills always sort above settled ones. Pure. */
  function filterBills(bills, opts) {
    opts = opts || {};
    var q = String(opts.q || '').trim().toLowerCase();
    var by = opts.sort || 'newest';
    var list = (bills || []).filter(function (b) {
      if (opts.payerId && b.payerId !== opts.payerId) return false;
      if (opts.category && normalizeCategory(b.category) !== opts.category) return false;
      if (q && String(b.name || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    list.sort(function (a, b) {
      var open = (a.settled ? 1 : 0) - (b.settled ? 1 : 0);
      if (open) return open;
      if (by === 'amountDesc') return num(b.amount, 0) - num(a.amount, 0);
      if (by === 'amountAsc') return num(a.amount, 0) - num(b.amount, 0);
      if (by === 'name') return String(a.name).localeCompare(String(b.name));
      if (by === 'oldest') return (a.date || '') < (b.date || '') ? -1 : 1;
      return (a.date || '') < (b.date || '') ? -1 : 1; // newest first
    });
    return list;
  }

    /* ---- Bill categories ---- */
  var BILL_CATEGORIES = [
    { id: 'rent', label: 'Rent' },
    { id: 'utilities', label: 'Utilities' },
    { id: 'groceries', label: 'Groceries' },
    { id: 'internet', label: 'Internet' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'other', label: 'Other' }
  ];

  function normalizeCategory(c) {
    c = String(c === undefined || c === null ? '' : c).trim().toLowerCase();
    for (var i = 0; i < BILL_CATEGORIES.length; i++) {
      if (BILL_CATEGORIES[i].id === c) return c;
    }
    return 'other';
  }

  function categoryLabel(id) {
    for (var i = 0; i < BILL_CATEGORIES.length; i++) {
      if (BILL_CATEGORIES[i].id === id) return BILL_CATEGORIES[i].label;
    }
    return 'Other';
  }

  /* Spending by category: totals + per-roommate share totals, biggest first.
   * Returns [{ category, label, total, count, perPerson: { roommateId: amount } }]. */
  function categoryTotals(roommates, bills) {
    var map = {};
    (bills || []).forEach(function (b) {
      var cat = normalizeCategory(b.category);
      if (!map[cat]) {
        map[cat] = { category: cat, label: categoryLabel(cat), total: 0, count: 0, perPerson: {} };
      }
      map[cat].total = round2(map[cat].total + num(b.amount, 0));
      map[cat].count++;
      var sh = shares(b, roommates);
      Object.keys(sh).forEach(function (id) {
        map[cat].perPerson[id] = round2(num(map[cat].perPerson[id], 0) + num(sh[id], 0));
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  /* Overdue bills: open bills with a due date before refDate (YYYY-MM-DD).
   * Oldest due date first. Pure. */
  function overdueBills(bills, refDate) {
    var ref = String(refDate || new Date().toISOString().slice(0, 10));
    return (bills || []).filter(function (b) {
      if (b.settled) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate || ''))) return false;
      return b.dueDate < ref;
    }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : (a.dueDate > b.dueDate ? 1 : 0); });
  }

  /* Per-person plain-text statement: what they paid, their shares, net.
   * Pure — used by the per-roommate "Statement" copy button. */
  function statementText(roommate, roommates, bills, payments) {
    var nm = {};
    roommates.forEach(function (r) { nm[r.id] = r.name; });
    var lines = ['RoommateSplit statement for ' + roommate.name + ':'];
    var paid = 0, share = 0;
    (bills || []).forEach(function (b) {
      if (b.settled) return;
      var sh = shares(b, roommates);
      if (b.payerId === roommate.id) {
        paid = round2(paid + num(b.amount, 0));
        lines.push('- Paid "' + b.name + '" ' + money(b.amount));
      }
      var mine = round2(num(sh[roommate.id], 0));
      if (mine > 0) {
        share = round2(share + mine);
        if (b.payerId !== roommate.id) {
          lines.push('- Owes ' + money(mine) + ' for "' + b.name + '" (paid by ' +
            (nm[b.payerId] || 'someone') + ')');
        }
      }
    });
    var net = round2(paid - share);
    lines.push('Total paid: ' + money(paid) + ' · total share: ' + money(share));
    lines.push(net >= 0
      ? 'Others owe you ' + money(net) + ' overall.'
      : 'You owe ' + money(-net) + ' overall.');
    return lines.join('\n');
  }


  return {
    SPLIT_RULES: SPLIT_RULES,
    BILL_CATEGORIES: BILL_CATEGORIES,
    num: num,
    money: money,
    uid: uid,
    blankRoommate: blankRoommate,
    blankBill: blankBill,
    validateRoommate: validateRoommate,
    validateBill: validateBill,
    shares: shares,
    balances: balances,
    settle: settle,
    totalOwedTo: totalOwedTo,
    totalOwes: totalOwes,
    billsCSV: billsCSV,
    summaryText: summaryText,
    addMonths: addMonths,
    filterBills: filterBills,
    normalizeCategory: normalizeCategory,
    categoryLabel: categoryLabel,
    categoryTotals: categoryTotals,
    overdueBills: overdueBills,
    statementText: statementText
  };
}));
