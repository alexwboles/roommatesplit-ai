/* RoommateSplit AI — UI. Requires window.RoommateSplit (js/split.js). */
(function () {
  'use strict';
  var S = window.RoommateSplit;
  var LS_RM = 'rmsplit.roommates.v1';
  var LS_BILL = 'rmsplit.bills.v1';
  var LS_PAY = 'rmsplit.payments.v1';

  // bill ledger search/filter/sort state (in-memory; ledger edits re-render it)
  var billFilter = { q: '', payerId: '', category: '', sort: 'newest' };

  function load(k, fb) {
    try { var raw = localStorage.getItem(k); if (raw) return JSON.parse(raw); }
    catch (e) {}
    return fb;
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nameOf(rms, id) {
    var f = null;
    rms.forEach(function (r) { if (r.id === id) f = r; });
    return f ? f.name : 'Someone';
  }

  var AV_COLORS = ['#157347', '#a86a12', '#1d6f8a', '#7a4a8a', '#8a5a1d', '#2e7d5b'];  function avatarColor(name) {
    var h = 0, s = String(name || '?');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }

  function dateBlock(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    if (!m) return '<div class="bill-date"><b>—</b>no date</div>';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '<div class="bill-date"><b>' + m[3].replace(/^0/, '') + '</b>' +
      months[+m[2] - 1] + ' ' + m[1] + '</div>';
  }

  function getState() {
    return {
      rms: load(LS_RM, []),
      bills: load(LS_BILL, []),
      pays: load(LS_PAY, [])
    };
  }

  function render() {
    var st = getState();
    renderRoommates(st);
    renderBalances(st);
    renderPayHistory(st);
    renderCategories(st);
    renderBills(st);
  }

  function renderCategories(st) {
    var box = el('categories');
    box.innerHTML = '';
    var rows = S.categoryTotals(st.rms, st.bills);
    if (!rows.length) {
      box.innerHTML = '<div class="empty small-empty">No bills yet — categories appear here.</div>';
      return;
    }
    rows.forEach(function (c) {
      var perPerson = st.rms.map(function (r) {
        var amt = S.num(c.perPerson[r.id], 0);
        return amt > 0 ? '<span class="who">' + esc(r.name) + '</span> ' + S.money(amt) : '';
      }).filter(Boolean).join(' · ');
      var d = document.createElement('div');
      d.className = 'cat-row';
      d.innerHTML = '<div class="cat-name">' + esc(c.label) +
        '<span class="cat-count">' + c.count + ' bill' + (c.count === 1 ? '' : 's') + '</span></div>' +
        '<div class="cat-total">' + S.money(c.total) + '</div>' +
        (perPerson ? '<div class="cat-split">' + perPerson + '</div>' : '');
      box.appendChild(d);
    });
  }

  function renderRoommates(st) {
    var box = el('roommates');
    box.innerHTML = '';
    if (!st.rms.length) box.innerHTML = '<div class="empty">Add your roommates to get started.</div>';
    st.rms.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'rm-row';
      d.innerHTML = '<span class="avatar" style="--av:' + avatarColor(r.name) + '" aria-hidden="true">' +
        esc(initials(r.name)) + '</span>' +
        '<div><div class="nm">' + esc(r.name) + '</div>' +
        '<div class="sz">' + (r.roomSize ? r.roomSize + ' sq ft room' : 'no room size') + '</div></div>' +
        '<div><button class="link-btn" data-stmt-rm="' + r.id + '" title="Copy a plain-text statement for this person">Statement</button>' +
        '<button class="link-btn" data-edit-rm="' + r.id + '" aria-label="Edit">Edit</button>' +
        '<button class="icon-btn" data-del-rm="' + r.id + '" aria-label="Remove">✕</button></div>';
      box.appendChild(d);
    });
    box.querySelectorAll('[data-stmt-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var st2 = getState();
        var r = null;
        st2.rms.forEach(function (x) { if (x.id === b.getAttribute('data-stmt-rm')) r = x; });
        if (!r) return;
        copyText(S.statementText(r, st2.rms, st2.bills, st2.pays), b);
      });
    });
    box.querySelectorAll('[data-del-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del-rm');
        if (!confirm('Remove this roommate and their bills?')) return;
        save(LS_RM, st.rms.filter(function (r) { return r.id !== id; }));
        save(LS_BILL, st.bills.filter(function (x) {
          return x.payerId !== id;
        }));
        render();
      });
    });
    box.querySelectorAll('[data-edit-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = null;
        st.rms.forEach(function (x) { if (x.id === b.getAttribute('data-edit-rm')) r = x; });
        if (r) openRoommateModal(r);
      });
    });
  }

  function renderBalances(st) {
    var net = S.balances(st.rms, st.bills, st.pays);
    var box = el('balances');
    box.innerHTML = '';
    if (!st.rms.length) { box.innerHTML = '<div class="empty">—</div>'; }
    else {
      st.rms.forEach(function (r) {
        var v = net[r.id] || 0;
        var cls = v > 0.004 ? 'owed' : (v < -0.004 ? 'owes' : 'even');
        var txt = v > 0.004 ? 'is owed ' + S.money(v)
          : (v < -0.004 ? 'owes ' + S.money(-v) : 'all settled up');
        var d = document.createElement('div');
        d.className = 'bal-row';
        d.innerHTML = '<div class="nm">' + esc(r.name) + '</div><div class="' + cls + '">' + txt + '</div>' +
          (cls === 'owes'
            ? '<button class="small ghost" data-remind="' + esc(r.id) + '" title="Copy a polite payment reminder">Remind</button>'
            : '');
        box.appendChild(d);
      });
    }
    box.querySelectorAll('[data-remind]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rid = btn.getAttribute('data-remind');
        var st2 = getState();
        var net2 = S.balances(st2.rms, st2.bills, st2.pays);
        var plan2 = S.settle(net2);
        var step = null;
        plan2.forEach(function (p) { if (p.fromId === rid) step = step || p; });
        if (!step) return;
        var msg = S.reminderText(nameOf(st2.rms, step.fromId), nameOf(st2.rms, step.toId), step.amount);
        var label = btn.textContent;
        var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1200); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(done, done);
        else done();
      });
    });
    var planBox = el('plan');
    planBox.innerHTML = '';
    var plan = S.settle(net);
    if (!plan.length) {
      planBox.innerHTML = '<div class="empty">Everyone is settled up — nothing is owed.</div>';
    } else {
      plan.forEach(function (p, i) {
        var d = document.createElement('div');
        d.className = 'step';
        d.innerHTML = '<span class="step-n">' + (i + 1) + '</span>' +
          '<div class="flow"><b>' + esc(nameOf(st.rms, p.fromId)) + '</b>' +
          '<span class="arrow" aria-hidden="true">→</span>' +
          '<b>' + esc(nameOf(st.rms, p.toId)) + '</b>' +
          '<span class="amt">' + S.money(p.amount) + '</span></div>' +
          '<button class="small" data-pay="' + i + '">Mark paid ✓</button>';
        planBox.appendChild(d);
      });
      planBox.querySelectorAll('[data-pay]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = plan[+b.getAttribute('data-pay')];
          var pays = load(LS_PAY, []);
          pays.push({ fromId: p.fromId, toId: p.toId, amount: p.amount,
                      date: new Date().toISOString().slice(0, 10) });
          save(LS_PAY, pays);
          render();
        });
      });
    }
    el('settle-all').style.display = plan.length ? '' : 'none';
    el('copy-summary').style.display = plan.length ? '' : 'none';
  }

  function renderPayHistory(st) {
    var box = el('payhist');
    box.innerHTML = '';
    if (!st.pays.length) {
      box.innerHTML = '<div class="empty small-empty">No payments recorded yet — use “Mark paid” on a settlement step.</div>';
      return;
    }
    st.pays.slice().reverse().forEach(function (p, ri) {
      var idx = st.pays.length - 1 - ri;
      var d = document.createElement('div');
      d.className = 'pay-row';
      d.innerHTML = '<span class="pay-date">' + esc(p.date || '') + '</span>' +
        '<div class="pay-flow">' + esc(nameOf(st.rms, p.fromId)) +
        '<span class="arrow" aria-hidden="true">→</span>' + esc(nameOf(st.rms, p.toId)) + '</div>' +
        '<div class="pay-amt">' + S.money(p.amount) + '</div>' +
        '<button class="icon-btn" data-undo-pay="' + idx + '" aria-label="Undo payment">↩</button>';
      box.appendChild(d);
    });
    box.querySelectorAll('[data-undo-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pays = load(LS_PAY, []);
        pays.splice(+b.getAttribute('data-undo-pay'), 1);
        save(LS_PAY, pays);
        render();
      });
    });
  }

  function renderBills(st) {
    var box = el('bills');
    box.innerHTML = '';
    // overdue banner
    var overdue = S.overdueBills(st.bills);
    if (overdue.length) {
      var total = overdue.reduce(function (s, b) { return S.num(s, 0) + S.num(b.amount, 0); }, 0);
      var alert = document.createElement('div');
      alert.className = 'overdue-banner';
      alert.innerHTML = '<strong>' + overdue.length + ' overdue bill' + (overdue.length === 1 ? '' : 's') +
        '</strong> — ' + S.money(total) + ' past due: ' +
        overdue.slice(0, 3).map(function (b) { return esc(b.name) + ' (due ' + esc(b.dueDate) + ')'; }).join(', ') +
        (overdue.length > 3 ? ' +' + (overdue.length - 3) + ' more' : '');
      box.appendChild(alert);
    }
    // payer filter options (preserve the current selection across renders)
    var pf = el('bill-payer-filter');
    var curSel = pf.options.length ? pf.value : billFilter.payerId;
    pf.innerHTML = '<option value="">All payers</option>' + st.rms.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === curSel ? ' selected' : '') + '>' +
        esc(r.name) + '</option>';
    }).join('');
    billFilter.payerId = curSel;
    // category filter options (preserve selection across renders)
    var cf = el('bill-cat-filter');
    var curCat = cf.options.length ? cf.value : billFilter.category;
    cf.innerHTML = '<option value="">All categories</option>' + S.BILL_CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === curCat ? ' selected' : '') + '>' +
        esc(c.label) + '</option>';
    }).join('');
    billFilter.category = curCat;
    var filtered = S.filterBills(st.bills, billFilter);
    if (!st.bills.length) {
      box.innerHTML = '<div class="empty">No bills yet. Add rent, utilities, groceries — whoever paid, however you split.</div>';
      return;
    }
    if (!filtered.length) {
      box.innerHTML = '<div class="empty">No bills match your search — clear the filters to see the full ledger.</div>';
      return;
    }
    var sorted = filtered;
    sorted.forEach(function (b) {
      var sh = S.shares(b, st.rms);
      var shareTxt = st.rms.map(function (r) {
        return '<span class="who">' + esc(r.name) + '</span> ' + S.money(sh[r.id] || 0);
      }).join(' · ');
      var rule = b.splitRule === 'even' ? 'evenly' : (b.splitRule === 'bysize' ? 'by room size' : 'custom %');
      var isOverdue = !b.settled && /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate || '')) &&
        b.dueDate < new Date().toISOString().slice(0, 10);
      var d = document.createElement('div');
      d.className = 'bill' + (b.settled ? ' settled' : '') + (isOverdue ? ' overdue' : '');
      d.innerHTML = dateBlock(b.date) +
        '<div><h4>' + esc(b.name) + ' <span class="bill-amt">' + S.money(b.amount) + '</span></h4>' +
        '<div class="meta">paid by ' + esc(nameOf(st.rms, b.payerId)) +
        ' · split ' + rule +
        ' · <span class="cat-pill">' + esc(S.categoryLabel(S.normalizeCategory(b.category))) + '</span>' +
        (b.dueDate ? ' · due ' + esc(b.dueDate) : '') +
        (isOverdue ? ' <span class="overdue-pill">OVERDUE</span>' : '') +
        (b.settled ? '<span class="settled-pill">Settled</span>' : '') +
        (b.repeats === 'monthly' ? '<span class="recur-pill">monthly</span>' : '') + '</div>' +
        '<div class="shares">' + shareTxt + '</div></div>' +
        '<div class="bill-actions">' +
        '<button class="small" data-edit-bill="' + b.id + '">Edit</button>' +
        '<button class="small ghost" data-repeat-bill="' + b.id + '">Repeat next month</button>' +
        '<button class="small ghost" data-toggle-bill="' + b.id + '">' +
        (b.settled ? 'Reopen' : 'Mark settled') + '</button></div>';
      box.appendChild(d);
    });
    box.querySelectorAll('[data-edit-bill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = null;
        st.bills.forEach(function (x) { if (x.id === b.getAttribute('data-edit-bill')) f = x; });
        if (f) openBillModal(f);
      });
    });
    box.querySelectorAll('[data-toggle-bill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var bills = load(LS_BILL, []);
        bills.forEach(function (x) {
          if (x.id === b.getAttribute('data-toggle-bill')) x.settled = !x.settled;
        });
        spawnRecurring(bills);
        render();
      });
    });
    box.querySelectorAll('[data-repeat-bill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var bills = load(LS_BILL, []);
        var src = null;
        bills.forEach(function (x) { if (x.id === b.getAttribute('data-repeat-bill')) src = x; });
        if (!src) return;
        var nb = JSON.parse(JSON.stringify(src));
        nb.id = S.uid('b');
        nb.date = S.addMonths(src.date, 1);
        nb.settled = false;
        bills.push(nb);
        save(LS_BILL, bills);
        render();
      });
    });
  }

  /* ---- modals ---- */

  function openModal(title, bodyHTML) {
    el('modal-title').textContent = title;
    el('modal-body').innerHTML = bodyHTML;
    el('modal').classList.remove('hidden');
  }
  function closeModal() { el('modal').classList.add('hidden'); }

  function openRoommateModal(r) {
    var isNew = !r;
    r = r || S.blankRoommate();
    openModal(isNew ? 'Add roommate' : 'Edit roommate',
      '<label>Name *<input id="m-rm-name" value="' + esc(r.name) + '" maxlength="40"></label>' +
      '<label>Room size (sq ft, optional)<input id="m-rm-size" type="number" min="0" value="' + (r.roomSize || '') + '"></label>' +
      '<div class="errors" id="m-err"></div>' +
      '<div class="form-actions"><button id="m-save">Save</button>' +
      (isNew ? '' : '<button id="m-del" class="danger">Remove</button>') + '</div>');
    el('m-save').addEventListener('click', function () {
      r.name = el('m-rm-name').value.trim();
      r.roomSize = S.num(el('m-rm-size').value, 0);
      var errs = S.validateRoommate(r);
      if (errs.length) { el('m-err').innerHTML = errs.map(esc).join('<br>'); return; }
      var rms = load(LS_RM, []);
      var i = -1;
      rms.forEach(function (x, xi) { if (x.id === r.id) i = xi; });
      if (i >= 0) rms[i] = r; else rms.push(r);
      save(LS_RM, rms);
      closeModal(); render();
    });
    var del = el('m-del');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Remove ' + r.name + '?')) return;
      save(LS_RM, load(LS_RM, []).filter(function (x) { return x.id !== r.id; }));
      closeModal(); render();
    });
  }

  function openBillModal(b) {
    var isNew = !b;
    b = b || S.blankBill();
    var st = getState();
    if (!b.payerId && st.rms.length) b.payerId = st.rms[0].id;
    var payerOpts = st.rms.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === b.payerId ? ' selected' : '') + '>' +
        esc(r.name) + '</option>';
    }).join('');
    var ruleOpts = S.SPLIT_RULES.map(function (rl) {
      return '<option value="' + rl.id + '"' + (rl.id === b.splitRule ? ' selected' : '') + '>' +
        rl.label + '</option>';
    }).join('');
    var customRows = st.rms.map(function (r) {
      var v = b.customShares ? S.num(b.customShares[r.id], 0) : 0;
      return '<div class="custom-grid"><span>' + esc(r.name) + '</span>' +
        '<input type="number" min="0" max="100" step="1" data-cpct="' + r.id + '" value="' + v + '"></div>';
    }).join('');
    var catOpts = S.BILL_CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '"' + (S.normalizeCategory(b.category) === c.id ? ' selected' : '') + '>' +
        esc(c.label) + '</option>';
    }).join('');
    openModal(isNew ? 'Add bill' : 'Edit bill',
      '<div class="grid2">' +
      '<label>Bill name *<input id="m-b-name" value="' + esc(b.name) + '" maxlength="60"></label>' +
      '<label>Amount ($) *<input id="m-b-amt" type="number" min="0" step="0.01" value="' + (b.amount || '') + '"></label>' +
      '<label>Date<input id="m-b-date" type="date" value="' + esc(b.date || '') + '"></label>' +
      '<label>Due date (optional)<input id="m-b-due" type="date" value="' + esc(b.dueDate || '') + '"></label>' +
      '<label>Paid by<select id="m-b-payer">' + payerOpts + '</select></label>' +
      '<label>Category<select id="m-b-cat">' + catOpts + '</select></label>' +
      '<label class="check"><input id="m-b-recur" type="checkbox"' +
      (b.repeats === 'monthly' ? ' checked' : '') +
      '> <span>Repeats monthly — auto-create next month when settled</span></label>' +
      '</div>' +
      '<label>Split rule<select id="m-b-rule">' + ruleOpts + '</select></label>' +
      '<div id="m-custom" style="display:' + (b.splitRule === 'custom' ? '' : 'none') + '">' +
      '<p class="hint">Percentages must add up to 100%.</p>' + customRows + '</div>' +
      '<div class="errors" id="m-err"></div>' +
      '<div class="form-actions"><button id="m-save">Save bill</button>' +
      (isNew ? '' : '<button id="m-del" class="danger">Delete</button>') + '</div>');
    el('m-b-rule').addEventListener('change', function () {
      el('m-custom').style.display = el('m-b-rule').value === 'custom' ? '' : 'none';
    });
    el('m-save').addEventListener('click', function () {
      b.name = el('m-b-name').value.trim();
      b.amount = S.num(el('m-b-amt').value, 0);
      b.date = el('m-b-date').value;
      b.dueDate = el('m-b-due').value;
      b.category = S.normalizeCategory(el('m-b-cat').value);
      b.repeats = el('m-b-recur').checked ? 'monthly' : 'none';
      b.payerId = el('m-b-payer').value;
      b.splitRule = el('m-b-rule').value;
      b.customShares = {};
      el('modal-body').querySelectorAll('[data-cpct]').forEach(function (inp) {
        b.customShares[inp.getAttribute('data-cpct')] = S.num(inp.value, 0);
      });
      var errs = S.validateBill(b, st.rms);
      if (errs.length) { el('m-err').innerHTML = errs.map(esc).join('<br>'); return; }
      var bills = load(LS_BILL, []);
      var i = -1;
      bills.forEach(function (x, xi) { if (x.id === b.id) i = xi; });
      if (i >= 0) bills[i] = b; else bills.push(b);
      save(LS_BILL, bills);
      closeModal(); render();
    });
    var del = el('m-del');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Delete this bill?')) return;
      save(LS_BILL, load(LS_BILL, []).filter(function (x) { return x.id !== b.id; }));
      closeModal(); render();
    });
  }

  function sampleData() {
    var a = S.blankRoommate(); a.name = 'Alex'; a.roomSize = 180;
    var s = S.blankRoommate(); s.name = 'Sam'; s.roomSize = 140;
    var j = S.blankRoommate(); j.name = 'Jo'; j.roomSize = 120;
    var b1 = S.blankBill(); b1.name = 'Rent — Oct'; b1.amount = 2400; b1.payerId = a.id;
    b1.splitRule = 'bysize'; b1.date = '2026-10-01';
    var b2 = S.blankBill(); b2.name = 'Electric'; b2.amount = 96.40; b2.payerId = s.id;
    b2.splitRule = 'even'; b2.date = '2026-09-20';
    var b3 = S.blankBill(); b3.name = 'Groceries'; b3.amount = 142.75; b3.payerId = j.id;
    b3.splitRule = 'custom'; b3.customShares = {}; b3.customShares[a.id] = 40;
    b3.customShares[s.id] = 35; b3.customShares[j.id] = 25; b3.date = '2026-09-25';
    return { rms: [a, s, j], bills: [b1, b2, b3], pays: [] };
  }

  /* ---- clipboard + download helpers ---- */

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function copyText(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text); done();
      });
    } else {
      fallbackCopy(text); done();
    }
  }

  function downloadCSV(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // Auto-create next-month instances for settled monthly bills. Returns count.
  function spawnRecurring(bills) {
    var fresh = S.spawnRecurring(bills);
    if (fresh.length) {
      fresh.forEach(function (b) { bills.push(b); });
      save(LS_BILL, bills);
    }
    return fresh.length;
  }

  function init() {
    // Recurring bills: pick up where the last session left off.
    spawnRecurring(load(LS_BILL, []));
    el('add-rm').addEventListener('click', function () { openRoommateModal(null); });
    el('add-bill').addEventListener('click', function () {
      if (!load(LS_RM, []).length) {
        alert('Add roommates first, then bills.');
        return;
      }
      openBillModal(null);
    });
    // bill ledger search / filter / sort
    el('bill-search').addEventListener('input', function () {
      billFilter.q = el('bill-search').value;
      renderBills(getState());
    });
    el('bill-payer-filter').addEventListener('change', function () {
      billFilter.payerId = el('bill-payer-filter').value;
      renderBills(getState());
    });
    el('bill-cat-filter').addEventListener('change', function () {
      billFilter.category = el('bill-cat-filter').value;
      renderBills(getState());
    });
    el('bill-sort').addEventListener('change', function () {
      billFilter.sort = el('bill-sort').value;
      renderBills(getState());
    });
    el('export-csv').addEventListener('click', function () {
      var st = getState();
      downloadCSV('roommatesplit-bills.csv', S.billsCSV(st.rms, st.bills));
    });
    el('copy-summary').addEventListener('click', function () {
      var st = getState();
      var plan = S.settle(S.balances(st.rms, st.bills, st.pays));
      copyText(S.summaryText(st.rms, plan), el('copy-summary'));
    });
    el('modal-close').addEventListener('click', closeModal);
    el('modal').addEventListener('click', function (e) {
      if (e.target === el('modal')) closeModal();
    });
    el('settle-all').addEventListener('click', function () {
      var st = getState();
      var plan = S.settle(S.balances(st.rms, st.bills, st.pays));
      if (!plan.length) return;
      if (!confirm('Record ' + plan.length + ' payment(s) as paid?')) return;
      var pays = load(LS_PAY, []);
      plan.forEach(function (p) {
        pays.push({ fromId: p.fromId, toId: p.toId, amount: p.amount,
                    date: new Date().toISOString().slice(0, 10) });
      });
      save(LS_PAY, pays);
      render();
    });

    // seed samples on first run
    if (!load(LS_RM, null)) {
      var smp = sampleData();
      save(LS_RM, smp.rms); save(LS_BILL, smp.bills); save(LS_PAY, smp.pays);
    }
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
