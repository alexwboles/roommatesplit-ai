/* RoommateSplit AI — UI. Requires window.RoommateSplit (js/split.js). */
(function () {
  'use strict';
  var S = window.RoommateSplit;
  var LS_RM = 'rmsplit.roommates.v1';
  var LS_BILL = 'rmsplit.bills.v1';
  var LS_PAY = 'rmsplit.payments.v1';

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

  var AV_COLORS = ['#157347', '#a86a12', '#1d6f8a', '#7a4a8a', '#8a5a1d', '#2e7d5b'];
  function avatarColor(name) {
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
    renderBills(st);
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
        '<div><button class="link-btn" data-edit-rm="' + r.id + '" aria-label="Edit">Edit</button>' +
        '<button class="icon-btn" data-del-rm="' + r.id + '" aria-label="Remove">✕</button></div>';
      box.appendChild(d);
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
        d.innerHTML = '<div class="nm">' + esc(r.name) + '</div><div class="' + cls + '">' + txt + '</div>';
        box.appendChild(d);
      });
    }
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
  }

  function renderBills(st) {
    var box = el('bills');
    box.innerHTML = '';
    if (!st.bills.length) {
      box.innerHTML = '<div class="empty">No bills yet. Add rent, utilities, groceries — whoever paid, however you split.</div>';
      return;
    }
    var sorted = st.bills.slice().sort(function (a, b) {
      return (a.settled ? 1 : 0) - (b.settled ? 1 : 0) || (b.date < a.date ? -1 : 1);
    });
    sorted.forEach(function (b) {
      var sh = S.shares(b, st.rms);
      var shareTxt = st.rms.map(function (r) {
        return '<span class="who">' + esc(r.name) + '</span> ' + S.money(sh[r.id] || 0);
      }).join(' · ');
      var rule = b.splitRule === 'even' ? 'evenly' : (b.splitRule === 'bysize' ? 'by room size' : 'custom %');
      var d = document.createElement('div');
      d.className = 'bill' + (b.settled ? ' settled' : '');
      d.innerHTML = dateBlock(b.date) +
        '<div><h4>' + esc(b.name) + ' <span class="bill-amt">' + S.money(b.amount) + '</span></h4>' +
        '<div class="meta">paid by ' + esc(nameOf(st.rms, b.payerId)) +
        ' · split ' + rule + (b.settled ? '<span class="settled-pill">Settled</span>' : '') + '</div>' +
        '<div class="shares">' + shareTxt + '</div></div>' +
        '<div class="bill-actions">' +
        '<button class="small" data-edit-bill="' + b.id + '">Edit</button>' +
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
    openModal(isNew ? 'Add bill' : 'Edit bill',
      '<div class="grid2">' +
      '<label>Bill name *<input id="m-b-name" value="' + esc(b.name) + '" maxlength="60"></label>' +
      '<label>Amount ($) *<input id="m-b-amt" type="number" min="0" step="0.01" value="' + (b.amount || '') + '"></label>' +
      '<label>Date<input id="m-b-date" type="date" value="' + esc(b.date || '') + '"></label>' +
      '<label>Paid by<select id="m-b-payer">' + payerOpts + '</select></label>' +
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

  function init() {
    el('add-rm').addEventListener('click', function () { openRoommateModal(null); });
    el('add-bill').addEventListener('click', function () {
      if (!load(LS_RM, []).length) {
        alert('Add roommates first, then bills.');
        return;
      }
      openBillModal(null);
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
