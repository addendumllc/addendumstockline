/* Addendum-Stockline forecasting engine — pure functions, no DOM. */
var ENGINE = (function () {
  var DAY = 86400000;
  function parseD(s) { var a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(s, n) { return iso(parseD(s) + n * DAY); }
  function diff(a, b) { return Math.round((parseD(b) - parseD(a)) / DAY); } // b - a
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  // Round an order up to a lot size people actually order: steps of 5 up to 25, 10 up to 100, 25 up to 500, then 50.
  function practicalQty(n) { if (n <= 0) return 0; var step = n <= 25 ? 5 : n <= 100 ? 10 : n <= 500 ? 25 : 50; return Math.ceil(n / step) * step; }
  function monthOf(s) { return parseD(s) ? new Date(parseD(s)).getUTCMonth() : 0; }

  var OPEN = { submitted: 1, in_production: 1, shipped: 1, partially_received: 1 };

  var DEFAULT_SETTINGS = {
    period: 'smart', ssMethod: 'days', ssDays: 14, ssUnits: 20, ssPct: 25,
    coverDays: 60, soonDays: 7, watchDays: 21, currency: 'USD',
    defaultProdLead: 30, defaultTransit: 7, defaultSupplier: '',
    roundToCase: true, roundPractical: true, countDrafts: false,
    inferStockouts: true, trimOutliers: true, useSeasonality: true,
    notify: { stockout: true, order: true, low: true, supplier: true, spike: true, overdue: true, digest: false },
    autoSync: 'daily', showMoqTiming: true, moqSlowDays: 120, salonDeduct: false
  };

  function settingsOf(s) {
    var o = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (s) for (var k in s) if (s[k] !== undefined && s[k] !== null && s[k] !== '') o[k] = s[k];
    return o;
  }

  /* Build the per-day history for the last `n` days before asOf (k=1 is yesterday). */
  function history(p, asOf, n) {
    var d = p.daily || [], len = d.length;
    var lag = p.end ? diff(p.end, asOf) - 1 : 0; // days between end and yesterday
    var oosSet = {};
    (p.oos || []).forEach(function (r) {
      var a = diff(r[0], asOf), b = diff(r[1], asOf); // a >= b (days ago)
      for (var k = Math.max(1, b); k <= a; k++) oosSet[k] = 1;
    });
    var launchK = p.launch ? diff(p.launch, asOf) : Infinity;
    var out = [];
    for (var k = 1; k <= n; k++) {
      var idx = len - 1 - lag - (k - 1);
      var missing = idx < 0 || idx >= len || k > launchK;
      out.push({ k: k, date: addDays(asOf, -k), u: missing ? 0 : (d[idx] || 0), missing: missing, oos: !!oosSet[k], inferred: false });
    }
    return out;
  }

  function quantile(arr, q) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  function analyze(p, ctx) {
    var S = ctx.settings, asOf = ctx.asOf, W = ctx.whatif || {};
    var ov = p.overrides || {};
    var H = history(p, asOf, 456);

    // --- Infer stockouts from improbable zero-sale runs (Poisson p < 1%) ---
    var avail = H.filter(function (h) { return !h.missing && !h.oos; });
    var r90raw = (function () {
      var x = H.slice(0, 90).filter(function (h) { return !h.missing && !h.oos; });
      if (x.length < 10) x = avail.slice(0, 180);
      var s = 0; x.forEach(function (h) { s += h.u; }); return x.length ? s / x.length : 0;
    })();
    var inferredDays = 0;
    if (S.inferStockouts && r90raw >= 0.3) {
      var run = [];
      var flush = function () {
        if (run.length >= 7 && r90raw * run.length > 8) { run.forEach(function (h) { h.oos = true; h.inferred = true; }); inferredDays += run.length; }
        run = [];
      };
      H.forEach(function (h) { if (!h.missing && !h.oos && h.u === 0) run.push(h); else flush(); });
      flush();
    }
    // also: currently out of stock & zero sales recently -> those days are stockout
    var ok = function (h) { return !h.missing && !h.oos; };

    // --- Outlier cap ---
    var inStock365 = H.slice(0, 365).filter(ok).map(function (h) { return h.u; });
    var mean365 = inStock365.length ? inStock365.reduce(function (a, b) { return a + b; }, 0) / inStock365.length : 0;
    var cap = Math.max(3, Math.ceil(quantile(inStock365, 0.97) * 1.6), Math.ceil(mean365 * 4));
    if (!S.trimOutliers) cap = Infinity;
    var outlierDays = [];
    H.forEach(function (h) { h.uc = Math.min(h.u, cap); if (h.u > cap && ok(h) && h.k <= 365) outlierDays.push({ date: h.date, units: h.u, capped: cap }); });

    function win(from, to) { // k in [from, to]
      var s = 0, raw = 0, n = 0, cal = 0, oos = 0;
      for (var k = from; k <= to && k <= H.length; k++) {
        var h = H[k - 1]; if (h.missing) continue; cal++;
        raw += h.u;
        if (h.oos) { oos++; continue; }
        s += h.uc; n++;
      }
      var need = Math.max(4, Math.round((to - from + 1) * 0.25));
      return { rate: n >= need ? s / n : null, sold: raw, inStock: n, days: cal, oosDays: oos };
    }
    var w7 = win(1, 7), w14 = win(1, 14), w30 = win(1, 30), w60 = win(1, 60), w90 = win(1, 90), w365 = win(1, 365);
    var p30 = win(31, 60), p90 = win(91, 180);

    var ageDays = p.launch ? diff(p.launch, asOf) : 9999;
    var isLaunch = ageDays < 75;
    var sinceLaunch = isLaunch ? win(1, ageDays) : null;

    // --- Trend ---
    var g30 = (w30.rate != null && p30.rate) ? w30.rate / p30.rate : null;
    var g90 = (w90.rate != null && p90.rate) ? w90.rate / p90.rate : null;
    var g = g30 != null && g90 != null ? g30 * 0.6 + g90 * 0.4 : (g30 != null ? g30 : g90);
    if (isLaunch && w14.rate != null && sinceLaunch && sinceLaunch.rate) g = w14.rate / sinceLaunch.rate;
    var trend = g == null ? 'stable' : g > 1.15 ? 'increasing' : g < 0.85 ? 'decreasing' : 'stable';

    // --- Seasonality (needs ~12 months) ---
    var monthly = [], seasonal = false, sIdx = null;
    var mAgg = {};
    H.slice(0, 365).forEach(function (h) {
      if (!ok(h)) return; var m = monthOf(h.date); mAgg[m] = mAgg[m] || { s: 0, n: 0 }; mAgg[m].s += h.uc; mAgg[m].n++;
    });
    var months = Object.keys(mAgg).filter(function (m) { return mAgg[m].n >= 10; });
    if (months.length >= 11) {
      var rates = {}; var tot = 0;
      months.forEach(function (m) { rates[m] = mAgg[m].s / mAgg[m].n; tot += rates[m]; });
      var mean = tot / months.length, v = 0, mx = 0, mn = Infinity;
      months.forEach(function (m) { v += Math.pow(rates[m] - mean, 2); mx = Math.max(mx, rates[m]); mn = Math.min(mn, rates[m]); });
      var cv = mean ? Math.sqrt(v / months.length) / mean : 0;
      seasonal = cv > 0.3 && mn > 0 && mx / mn > 2;
      sIdx = [];
      for (var m = 0; m < 12; m++) sIdx.push(rates[m] != null && mean ? 0.5 + 0.5 * (rates[m] / mean) : 1);
      monthly = sIdx;
    }
    var useSeason = seasonal && S.useSeasonality && !isLaunch;
    function sFactor(dateIso) { return useSeason ? sIdx[monthOf(dateIso)] : 1; }

    // --- Base daily rate ---
    var period = ov.period || S.period;
    var method = [], base;
    function pick(list) { for (var i = 0; i < list.length; i++) if (list[i] && list[i].rate != null) return list[i].rate; return 0; }
    if (ov.velocity != null && ov.velocity !== '') {
      base = +ov.velocity; method.push('Manual sales rate of ' + fx(base) + '/day');
    } else if (isLaunch) {
      var a = w14.rate, b = sinceLaunch && sinceLaunch.rate;
      base = a != null && b != null ? 0.6 * a + 0.4 * b : (a != null ? a : (b || 0));
      method.push('New launch (' + ageDays + ' days): 60% last-14-day rate + 40% since-launch rate');
    } else if (period === 'smart') {
      var parts = [[w30, 0.5, '30-day'], [w90, 0.3, '90-day'], [w7, 0.2, '7-day']], s = 0, wt = 0, used = [];
      parts.forEach(function (x) { if (x[0].rate != null) { s += x[0].rate * x[1]; wt += x[1]; used.push(Math.round(x[1] * 100) + '% ' + x[2]); } });
      base = wt ? s / wt : pick([w365]);
      method.push('Blended rate: ' + (used.join(' + ') || '12-month average'));
      if (useSeason) {
        var recentIdx = 0, c = 0;
        H.slice(0, 30).forEach(function (h) { recentIdx += sIdx[monthOf(h.date)]; c++; });
        recentIdx = c ? recentIdx / c : 1;
        base = base / recentIdx;
        method.push('Seasonality removed from recent rate, then applied by month going forward');
      }
      if (trend !== 'stable' && g != null) {
        var adj = 1 + 0.5 * (clamp(g, 0.6, 1.6) - 1);
        base *= adj;
        method.push('Trend adjustment ×' + adj.toFixed(2) + ' (sales ' + trend + ')');
      }
    } else {
      var map = { '7': [w7, w30, w90, w365], '30': [w30, w90, w365], '60': [w60, w90, w365], '90': [w90, w365], '365': [w365, w90] };
      base = pick(map[period] || [w30]);
      method.push((period === '365' ? '12-month' : period + '-day') + ' average (in-stock days only)');
    }
    if (w30.oosDays + w90.oosDays > 0 && ov.velocity == null) method.push('Out-of-stock days excluded from the average' + (inferredDays ? ' (' + inferredDays + ' inferred from zero-sale runs)' : ''));
    if (outlierDays.length && ov.velocity == null) method.push(outlierDays.length + ' unusual sales day' + (outlierDays.length > 1 ? 's' : '') + ' capped at ' + cap + ' units');

    var salesMult = 1 + (W.salesPct || 0) / 100;
    var promos = (p.promos || []).concat(W.promo ? [W.promo] : []);
    function promoF(dateIso) {
      var f = 1; promos.forEach(function (pr) { if (pr.start && pr.end && dateIso >= pr.start && dateIso <= pr.end) f *= 1 + (pr.lift || 0) / 100; }); return f;
    }
    var seasonLift = 1 + (W.seasonPct || 0) / 100;
    function rate(t) { var d = addDays(asOf, t); return base * salesMult * seasonLift * (ov.velocity != null && ov.velocity !== '' ? 1 : sFactor(d)) * promoF(d); }

    // --- Lead time ---
    var sup = (ctx.suppliers || []).filter(function (s) { return s.id === p.supplierId; })[0];
    var prodLead = p.prodLead != null && p.prodLead !== '' ? +p.prodLead : sup && sup.prodLead != null ? +sup.prodLead : S.defaultProdLead;
    var transit = p.transit != null && p.transit !== '' ? +p.transit : sup && sup.shipLead != null ? +sup.shipLead : S.defaultTransit;
    var leadBase = ov.lead != null && ov.lead !== '' ? +ov.lead : prodLead + transit;
    var L = Math.max(1, Math.round(leadBase + (W.leadDays || 0)));

    var DL = 0; for (var t = 1; t <= L; t++) DL += rate(t);

    // --- Safety stock ---
    var ssMethod = p.ssMethod || S.ssMethod, SS;
    var avgRate = DL / L;
    if (ov.safety != null && ov.safety !== '') { SS = +ov.safety; ssMethod = 'manual'; }
    else if (ssMethod === 'units') SS = +(p.ssUnits != null ? p.ssUnits : S.ssUnits);
    else if (ssMethod === 'pct') SS = DL * (+(p.ssPct != null ? p.ssPct : S.ssPct)) / 100;
    else SS = avgRate * (+(p.ssDays != null ? p.ssDays : S.ssDays));
    SS = Math.ceil(SS);
    var ssDesc = ssMethod === 'manual' ? 'manual' : ssMethod === 'units' ? 'fixed units' : ssMethod === 'pct' ? (p.ssPct != null ? p.ssPct : S.ssPct) + '% of lead-time demand' : (p.ssDays != null ? p.ssDays : S.ssDays) + ' days of sales';

    // --- Incoming ---
    var arrivals = {}, incoming = 0, incomingLines = [], onOrder = [];
    (ctx.pos || []).forEach(function (po) {
      // Drafts always block a duplicate order, even when they don't count as incoming stock.
      var active = OPEN[po.status] || po.status === 'draft';
      var open = OPEN[po.status] || (S.countDrafts && po.status === 'draft');
      if (!active) return;
      (po.lines || []).forEach(function (ln) {
        if (ln.sku !== p.sku) return;
        var rem = Math.max(0, (+ln.qty || 0) - (+ln.received || 0) - (+ln.damaged || 0));
        if (!rem) return;
        if (onOrder.indexOf(po.id) < 0) onOrder.push(po.id);
        if (!open) return;
        var due = po.expectedDelivery || addDays(asOf, L);
        var dt = Math.max(1, diff(asOf, due));
        arrivals[dt] = (arrivals[dt] || 0) + rem; incoming += rem;
        incomingLines.push({ po: po.id, qty: rem, due: due, status: po.status, overdue: diff(asOf, due) < 0 });
      });
    });

    var onHand = +p.onHand || 0, committed = +p.committed || 0;
    var available = Math.max(0, onHand - committed);
    var cover = +(p.coverDays != null && p.coverDays !== '' ? p.coverDays : S.coverDays);
    var HZ = clamp(L + cover + 90, 150, 420);
    var proj = [available], inv = available, stockT = null, crossT = null, dipT = available < SS ? 0 : null;
    for (t = 1; t <= HZ; t++) {
      inv = Math.max(0, inv - rate(t)) + (arrivals[t] || 0); // no backorders: sales stop at zero
      proj.push(inv);
      if (stockT == null && inv <= 0 && base > 0) stockT = t;
      if (dipT == null && inv < SS) dipT = t;
      if (crossT == null && t >= L && inv < SS) crossT = t;
    }
    // A dip below safety stock before a new order could land can't be fixed by ordering later:
    // ordering today is the best possible, so treat it as due now.
    if (crossT == null && dipT != null && dipT < L && proj[L] < SS) crossT = L;
    if (available <= 0 && base > 0 && !(arrivals[1])) stockT = 0;

    var orderT = crossT == null ? null : crossT - L;
    var orderDate = orderT == null ? null : addDays(asOf, orderT);
    var orderOverridden = false;
    if (ov.orderDate) { orderDate = ov.orderDate; orderT = diff(asOf, ov.orderDate); orderOverridden = true; }

    // --- Quantity ---
    var placeT = orderT == null ? 0 : Math.max(0, orderT);
    var A = placeT + L;
    var atArrival = Math.max(0, A < proj.length ? proj[A] : proj[proj.length - 1]);
    var coverDemand = 0; for (t = A + 1; t <= A + cover; t++) coverDemand += rate(t);
    var laterArrivals = 0; for (var kk in arrivals) if (+kk > A && +kk <= A + cover) laterArrivals += arrivals[kk];
    var target = p.targetLevel != null && p.targetLevel !== '' ? +p.targetLevel : null;
    var rawQty = target != null ? target - atArrival - laterArrivals : coverDemand + SS - atArrival - laterArrivals;
    rawQty = Math.max(0, Math.ceil(rawQty));
    var moq = +p.moq || (sup && +sup.moq) || 0, pack = +p.casePack || 1;
    var qty = rawQty, rounding = [];
    var byCase = S.roundToCase && pack > 1;
    // Full cases are already a practical amount; otherwise round up to a sensible lot (7 → 10, 23 → 25).
    if (qty > 0 && !byCase && S.roundPractical !== false) { var qp = practicalQty(qty); if (qp !== qty) { rounding.push('rounded up to a practical ' + qp); qty = qp; } }
    // The supplier minimum is a hard floor for any recommendation.
    if (qty > 0 && moq && qty < moq) { rounding.push('raised to MOQ of ' + moq); qty = moq; }
    if (qty > 0 && byCase && qty % pack) { var q2 = Math.ceil(qty / pack) * pack; rounding.push('rounded up to case of ' + pack); qty = q2; }
    // Out of stock with nothing on order: always recommend something, even with no recent sales.
    var orderNow = available <= 0 && !onOrder.length && p.status !== 'discontinued' && p.status !== 'untracked';
    if (orderNow && qty <= 0) { qty = moq || (byCase ? pack : 1); rounding.push('out of stock with no sales forecast, so the minimum order of ' + qty); }
    var qtyOverridden = ov.qty != null && ov.qty !== '';
    if (qtyOverridden) qty = +ov.qty;

    // --- Status ---
    var discontinued = p.status === 'discontinued';
    var untracked = p.status === 'untracked'; // e.g. services or gift cards: sales count, stock doesn't
    var status;
    if (untracked) status = 'untracked';
    else if (discontinued) status = 'disc';
    else if (available <= 0) status = 'oos';
    else if (orderT != null && orderT <= 0) status = 'now';
    else if (orderT != null && orderT <= S.soonDays) status = 'soon';
    else if (orderT != null && orderT <= S.watchDays) status = 'watch';
    else status = 'healthy';
    if (discontinued || untracked) qty = 0;
    var atRisk = !discontinued && !untracked && stockT != null && stockT < L && stockT <= 45;
    // Out of stock items already on an active purchase order are being replenished: don't order them again.
    if (status !== 'oos') orderNow = false;
    var needsOrder = orderNow || ((status === 'now' || status === 'soon') && qty > 0);

    var lateGap = 0, lateUnits = 0;
    if (stockT != null && stockT < L && !discontinued && !untracked) { lateGap = L - stockT; for (t = stockT + 1; t <= L; t++) lateUnits += rate(t); }

    // survival check (business rule #25)
    var incomingInLead = 0; for (kk in arrivals) if (+kk <= L) incomingInLead += arrivals[kk];
    var survival = available + incomingInLead - DL - SS;

    var name = p.name;
    var reasons = [];
    reasons.push({ k: 'Available now', v: available + ' (' + onHand + ' on hand − ' + committed + ' committed)' });
    var draftOnly = onOrder.filter(function (id) { return !incomingLines.some(function (l) { return l.po === id; }); });
    if (draftOnly.length) reasons.push({ k: 'On draft purchase order', v: draftOnly.join(', ') + ' (not counted as incoming until submitted)' });
    if (incoming) reasons.push({ k: 'Already incoming', v: incoming + ' units on ' + incomingLines.map(function (l) { return l.po; }).join(', ') });
    reasons.push({ k: 'Forecast sales rate', v: fx(base * salesMult * seasonLift) + ' units/day' + (useSeason ? ' (before seasonal adjustment)' : '') });
    reasons.push({ k: 'Total lead time', v: L + ' days' + (ov.lead != null && ov.lead !== '' ? ' (manual)' : ' (' + prodLead + ' production + ' + transit + ' transit' + (W.leadDays ? ' + ' + W.leadDays + ' scenario' : '') + ')') });
    reasons.push({ k: 'Demand during lead time', v: Math.round(DL) + ' units' });
    reasons.push({ k: 'Safety stock', v: SS + ' units (' + ssDesc + ')' });
    reasons.push({ k: 'Reorder point', v: Math.round(DL + SS) + ' units' });
    reasons.push({ k: 'Survival check', v: (survival >= 0 ? '+' : '') + Math.round(survival) + ' units (available + incoming within lead time − lead-time demand − safety stock)' });

    var summary;
    if (untracked) summary = 'Not tracked in inventory. Sales are recorded, but stock, forecasts and reorders are skipped.';
    else if (discontinued) summary = 'Discontinued. Selling through remaining stock; no reorder recommended.';
    else if (qty <= 0 && status === 'healthy') summary = 'No order needed yet. Stock' + (incoming ? ' plus incoming purchase orders' : '') + ' covers forecast demand and safety stock past the next ' + (orderT != null ? orderT + L : HZ) + ' days.';
    else {
      summary = 'Based on ' + available + ' available units' + (incoming ? ' plus ' + incoming + ' incoming' : '') + ', sales of ' + fx(base * salesMult * seasonLift) + '/day and a ' + L + '-day lead time, stock is projected to fall below the ' + SS + '-unit safety level ' + (dipT === 0 ? 'now' : 'on ' + nice(addDays(asOf, dipT != null ? dipT : crossT))) + (dipT != null && dipT < L ? ', before a new order could arrive' : '') + '.';
      if (orderT != null && orderT < 0) summary += ' The order is ' + (-orderT) + ' days late.';
    }
    var qtyWhy = qty > 0 ? (target != null
      ? 'Order up to your target of ' + target + ': ' + target + ' − ' + Math.round(atArrival) + ' projected at arrival' + (laterArrivals ? ' − ' + laterArrivals + ' arriving later' : '') + ' = ' + rawQty
      : 'Cover ' + cover + ' days after the order lands (' + Math.round(coverDemand) + ' units) + safety stock (' + SS + ') − ' + Math.round(atArrival) + ' projected on hand at arrival' + (laterArrivals ? ' − ' + laterArrivals + ' arriving later' : '') + ' = ' + rawQty) + (rounding.length ? ', ' + rounding.join(', ') + ' → ' + qty : '') + (qtyOverridden ? '. Manual quantity: ' + qty : '') : '';

    return {
      sku: p.sku, p: p, sup: sup, base: base * salesMult * seasonLift, rawBase: base, rate: rate,
      w: { d7: w7, d14: w14, d30: w30, d60: w60, d90: w90, d365: w365, p30: p30, p90: p90 },
      g: g, g30: g30, trend: trend, seasonal: seasonal, sIdx: monthly, isLaunch: isLaunch, ageDays: ageDays,
      L: L, prodLead: prodLead, transit: transit, DL: DL, SS: SS, ssDesc: ssDesc, ROP: DL + SS,
      onHand: onHand, committed: committed, available: available, incoming: incoming, incomingLines: incomingLines, arrivals: arrivals, onOrder: onOrder, orderNow: orderNow,
      proj: proj, stockT: stockT, crossT: crossT, dipT: dipT, orderT: orderT, orderDate: orderDate, orderOverridden: orderOverridden,
      stockDate: stockT == null ? null : addDays(asOf, stockT), arriveT: A, arriveDate: addDays(asOf, A),
      qty: qty, rawQty: rawQty, qtyOverridden: qtyOverridden, moq: moq, pack: pack, cover: cover, target: target,
      status: status, needsOrder: needsOrder, atRisk: atRisk, lateGap: lateGap, lateUnits: Math.round(lateUnits), survival: survival,
      daysCover: base > 0 ? available / base : Infinity, method: method, reasons: reasons, summary: summary, qtyWhy: qtyWhy,
      outlierDays: outlierDays, inferredDays: inferredDays, hist: H, cost: +p.cost || 0, price: +p.price || 0,
      overrides: ov
    };
  }

  function fx(n) { return n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : n.toFixed(2); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nice(s) { var t = new Date(parseD(s)); return MON[t.getUTCMonth()] + ' ' + t.getUTCDate(); }

  function supplierPerf(sup, pos) {
    var rec = (pos || []).filter(function (po) { return po.supplierId === sup.id && (po.status === 'received' || po.status === 'partially_received') && po.submitted && po.receivedDate; });
    var n = rec.length, act = 0, st = 0, ontime = 0, ord = 0, got = 0;
    rec.forEach(function (po) {
      var a = diff(po.submitted, po.receivedDate), s = +po.statedLead || ((+sup.prodLead || 0) + (+sup.shipLead || 0));
      act += a; st += s; if (a <= s + 2) ontime++;
      (po.lines || []).forEach(function (l) { ord += +l.qty || 0; got += +l.received || 0; });
    });
    var stated = (+sup.prodLead || 0) + (+sup.shipLead || 0);
    var avgAct = n ? act / n : null, avgStated = n ? st / n : null;
    var delay = n ? avgAct - stated : 0;
    var score = n ? Math.round(clamp(100 - Math.max(0, delay) * 3 - (1 - got / Math.max(1, ord)) * 100 * 0.5 - (1 - ontime / n) * 20, 0, 100)) : null;
    return { n: n, avgActual: avgAct, avgStated: avgStated, stated: stated, delay: delay, onTime: n ? ontime / n : null, fill: ord ? got / ord : null, flag: n >= 2 && delay >= 5, score: score };
  }

  return { analyze: analyze, supplierPerf: supplierPerf, settingsOf: settingsOf, DEFAULT_SETTINGS: DEFAULT_SETTINGS, history: history,
    parseD: parseD, iso: iso, addDays: addDays, diff: diff, nice: nice, fx: fx, MON: MON, OPEN: OPEN };
})();
if (typeof module !== 'undefined') module.exports = ENGINE;
