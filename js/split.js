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

  return {
    SPLIT_RULES: SPLIT_RULES,
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
    totalOwes: totalOwes
  };
}));
