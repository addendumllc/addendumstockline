/* Custom colors and logo. Shared by the app and the sign-in page. */
var BRAND = {
  presets: [
    { name: 'Plum (default)', accent: '#6b2d5c', sidebar: '#1f1a22', background: '#f4f3f5' },
    { name: 'Espresso', accent: '#8a5a3c', sidebar: '#231b16', background: '#f6f2ee' },
    { name: 'Blush', accent: '#b5546e', sidebar: '#2a1d22', background: '#f8f1f2' },
    { name: 'Sage', accent: '#4f6f52', sidebar: '#1b211c', background: '#f2f4f1' },
    { name: 'Ink', accent: '#2f4b7c', sidebar: '#161a22', background: '#f2f3f6' },
    { name: 'Gold', accent: '#9a7419', sidebar: '#1f1c15', background: '#f6f4ee' }
  ],
  lum: function (hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  },
  mix: function (a, b, t) { // t = share of a
    var o = '#'; for (var i = 1; i < 7; i += 2) { var v = Math.round(parseInt(a.substr(i, 2), 16) * t + parseInt(b.substr(i, 2), 16) * (1 - t)); o += ('0' + v.toString(16)).slice(-2); } return o;
  },
  ok: function (h) { return /^#[0-9a-f]{6}$/i.test(h || ''); },
  // Builds CSS that overrides the theme tokens in light and dark, keeping text readable on the chosen colors.
  css: function (b) {
    b = b || {}; var out = '', L = [], D = [];
    if (BRAND.ok(b.accent)) {
      var ink = BRAND.lum(b.accent) > 0.45 ? '#1d1a21' : '#ffffff';
      L.push('--accent:' + b.accent, '--accent-ink:' + ink, '--accent-soft:color-mix(in oklab,' + b.accent + ' 12%,var(--surface))', '--accent-line:color-mix(in oklab,' + b.accent + ' 35%,var(--surface))', '--chart-1:' + b.accent);
      var da = BRAND.mix(b.accent, '#ffffff', 0.62);
      D.push('--accent:' + da, '--accent-ink:#1d1a21', '--accent-soft:color-mix(in oklab,' + b.accent + ' 28%,var(--surface))', '--accent-line:color-mix(in oklab,' + b.accent + ' 50%,var(--surface))', '--chart-1:' + da);
    }
    if (BRAND.ok(b.sidebar)) {
      var light = BRAND.lum(b.sidebar) > 0.4;
      var side = ['--side:' + b.sidebar, '--side-ink:' + (light ? '#1d1a21' : '#f2eef4'), '--side-dim:' + (light ? 'color-mix(in oklab,#1d1a21 62%,' + b.sidebar + ')' : 'color-mix(in oklab,#ffffff 58%,' + b.sidebar + ')'),
        '--side-hover:color-mix(in oklab,' + b.sidebar + ' 88%,' + (light ? '#000000' : '#ffffff') + ')', '--side-active:color-mix(in oklab,' + b.sidebar + ' 80%,' + (light ? '#000000' : '#ffffff') + ')'];
      L = L.concat(side); D = D.concat(side);
    }
    if (BRAND.ok(b.background) && BRAND.lum(b.background) > 0.6) L.push('--bg:' + b.background);
    if (L.length) out += ':root{' + L.join(';') + '}';
    if (D.length) out += '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + D.join(';') + '}}:root[data-theme="dark"]{' + D.join(';') + '}';
    return out;
  },
  apply: function (b) {
    var el = document.getElementById('brand-css');
    if (!el) { el = document.createElement('style'); el.id = 'brand-css'; document.head.appendChild(el); }
    el.textContent = BRAND.css(b);
    if (b && b.appName) document.title = document.title.replace(/Addendum-Stockline|Stockline/, b.appName);
  },
  // Reads an image file into a data URL, shrinking large photos first so uploads stay small.
  read: function (file, maxSide) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file chosen.'));
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Choose a PNG, JPG, WebP or GIF image.'));
      if (file.size > 20 * 1024 * 1024) return reject(new Error('That image is over 20 MB.'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read that file.')); };
      fr.onload = function () {
        if (file.type === 'image/gif') return resolve(fr.result);
        var img = new Image();
        img.onerror = function () { reject(new Error('That image could not be opened.')); };
        img.onload = function () {
          var s = Math.min(1, (maxSide || 1200) / Math.max(img.width, img.height));
          if (s === 1 && file.size < 1.5 * 1024 * 1024) return resolve(fr.result);
          var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
};
