// Run: node scripts/test-popup-sanitizer.js
// The login pop-up HTML is shown to every visitor — it must never carry script.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const POPUP_TAGS'), b = src.indexOf('/* ---- public: the live pop-up');
assert(a > 0 && b > a);
const ctx = { String, Number, Math, Date, isNaN, Set }; vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + ';this.s=sanitizePopupHtml;this.c=_popupClean;', ctx);
const s = ctx.s;
const bad = [
  '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<img src="javascript:alert(1)">',
  '<a href="javascript:alert(1)">x</a>', '<a href="//evil.com">x</a>', '<iframe src="https://evil.com"></iframe>',
  '<svg onload=alert(1)>', '<p style="background:url(javascript:alert(1))">x</p>', '<p onclick="x()">x</p>',
  '<div style="width:expression(alert(1))">x</div>', '<scr<script>ipt>alert(1)</script>', '<object data="x"></object>',
  '<style>body{display:none}</style>', '<form action="https://evil"><input></form>', '<a href=" javascript:alert(1)">x</a>',
  '<img src="data:image/svg+xml,<svg onload=alert(1)>">', '<math><mtext><img src=x onerror=alert(1)></mtext></math>'
];
bad.forEach(h => {
  const out = s(h);
  assert(!/<script|onerror|onload|onclick|javascript:|<iframe|<svg|expression\(|<object|<style|<form|<input|data:image/i.test(out), 'unsafe: ' + h + ' → ' + out);
});
const good = '<h1 style="text-align: center; color: #fde68a;">🪔 Happy Diwali</h1><p><b>Bold</b> <span style="font-size: 20px;">big</span> <a href="https://altitudeacademy.example/x">link</a></p><img src="/popup-media/pp-abc-0123456789.webp" style="width: 50%; border-radius: 14px;"><ul><li>one</li></ul>';
const out = s(good);
['<h1', 'text-align: center', 'color: #fde68a', '<b>', 'font-size: 20px', 'href="https://altitudeacademy.example/x"', 'target="_blank"', 'src="/popup-media/pp-abc-0123456789.webp"', 'width: 50%', '<li>one</li>', '🪔']
  .forEach(k => assert(out.includes(k), 'kept: ' + k + ' in ' + out));
const c = ctx.c({ name: '', durationSec: 999, showOn: 'evil', frequency: 'x', design: { bg1: 'red;background:url(x)', width: 'xl' }, button: { text: 'Go', url: 'javascript:alert(1)' }, startAt: 'nope' });
assert.strictEqual(c.durationSec, 120); assert.strictEqual(c.showOn, 'both'); assert.strictEqual(c.frequency, 'session');
assert.strictEqual(c.design.bg1, '#ffffff'); assert.strictEqual(c.design.width, 'md'); assert.strictEqual(c.button.url, ''); assert.strictEqual(c.startAt, null);
assert.strictEqual(ctx.c({ durationSec: 0 }).durationSec, 0, '0 = stays until closed');
console.log('✅ login pop-up sanitiser: passed');
