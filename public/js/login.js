(function () {
  var $ = function (id) { return document.getElementById(id); };
  function show(id) { ['loading', 'signin', 'setup', 'change'].forEach(function (x) { $(x).hidden = x !== id; }); var f = document.querySelector('#' + id + ' input'); if (f) f.focus(); }
  function err(id, msg) { var e = $('e-' + id); e.textContent = msg || ''; e.hidden = !msg; }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong (HTTP ' + r.status + ').'); return j; }); });
  }
  function next() {
    var n = new URLSearchParams(location.search).get('next') || '/';
    if (!/^\/(?!\/)/.test(n) || n.indexOf('/login') === 0) n = '/'; // only same-site paths
    location.href = n;
  }
  function busy(form, on) { form.querySelectorAll('button, input').forEach(function (el) { el.disabled = on; }); }

  document.querySelectorAll('[data-show]').forEach(function (b) {
    b.addEventListener('click', function () { var i = $(b.dataset.show); var t = i.type === 'password'; i.type = t ? 'text' : 'password'; b.textContent = t ? 'Hide' : 'Show'; i.focus(); });
  });

  $('su-pw').addEventListener('input', function () {
    var v = this.value, s = Math.min(100, v.length * 7 + (/[A-Z]/.test(v) ? 10 : 0) + (/\d/.test(v) ? 10 : 0) + (/[^A-Za-z0-9]/.test(v) ? 10 : 0));
    var m = $('su-meter'); m.style.width = s + '%'; m.style.background = v.length < 10 ? 'var(--now)' : s < 80 ? 'var(--watch)' : 'var(--ok)';
    $('su-hint').textContent = v.length < 10 ? (10 - v.length) + ' more character' + (10 - v.length === 1 ? '' : 's') + ' needed.' : 'Good.';
  });

  $('f-signin').addEventListener('submit', function (e) {
    e.preventDefault(); err('signin');
    var email = $('si-email').value.trim(), pw = $('si-pw').value;
    if (!email || !pw) { err('signin', 'Enter your email and password.'); return; }
    busy(this, true); var f = this;
    post('/api/auth/login', { email: email, password: pw, remember: $('si-remember').checked })
      .then(function (r) { if (r.mustChange) { busy(f, false); show('change'); } else next(); })
      .catch(function (x) { busy(f, false); err('signin', x.message); $('si-pw').select(); });
  });

  $('f-setup').addEventListener('submit', function (e) {
    e.preventDefault(); err('setup');
    var name = $('su-name').value.trim(), email = $('su-email').value.trim(), pw = $('su-pw').value;
    if (!name || !email) { err('setup', 'Enter your name and email.'); return; }
    if (pw.length < 10) { err('setup', 'Use at least 10 characters for the password.'); return; }
    busy(this, true); var f = this;
    post('/api/auth/setup', { name: name, email: email, password: pw }).then(next).catch(function (x) { busy(f, false); err('setup', x.message); });
  });

  $('f-change').addEventListener('submit', function (e) {
    e.preventDefault(); err('change');
    var a = $('ch-pw').value, b = $('ch-pw2').value;
    if (a.length < 10) { err('change', 'Use at least 10 characters.'); return; }
    if (a !== b) { err('change', 'The two passwords don\'t match.'); return; }
    busy(this, true); var f = this;
    post('/api/auth/password', { next: a }).then(next).catch(function (x) { busy(f, false); err('change', x.message); });
  });

  fetch('/api/auth/state').then(function (r) { return r.json(); }).then(function (s) {
    var b = s.branding || {};
    if (window.BRAND) BRAND.apply(b);
    if (b.appName) { $('appName').textContent = b.appName; document.title = 'Sign in · ' + b.appName; }
    if (b.logo) { $('brandLogo').src = b.logo; $('brandLogo').hidden = false; }
    if (s.setup) show('setup');
    else if (s.user && s.mustChange) show('change');
    else if (s.user) next();
    else show('signin');
  }).catch(function () { $('loading').textContent = 'Can\'t reach the Addendum-Stockline server. Make sure it is running, then reload.'; });
})();
