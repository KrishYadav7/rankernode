// Run: node scripts/test-office-render.js
// Checks how office materials are located and named for the in-app viewer.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const pick = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert(a >= 0 && b > a, 'section ' + from); return src.slice(a, b); };
const ctx = { path, crypto, URL, String, JWT_SECRET: 'test-secret-test-secret', console };
vm.createContext(ctx);
vm.runInContext(
  pick('const OFFICE_RENDER_EXTS', 'let _sofficeBin') +
  pick('const DERIVED_OFFICE_RE', '/* Put the original on local disk') +
  ';this.d=describeOfficeSource;this.rn=renderNameFor;this.on=originalNameForRender;this.re=DERIVED_OFFICE_RE;', ctx);

const disk = ctx.d({ _id: 'm1', url: '/uploads/1789-ab12.pptx' });
assert.strictEqual(disk.kind, 'disk'); assert.strictEqual(disk.diskName, '1789-ab12.pptx');
assert.strictEqual(ctx.rn('1789-ab12.pptx'), '1789-ab12_pptx-render.pdf');
assert.strictEqual(ctx.on('1789-ab12_pptx-render.pdf.preview'), '1789-ab12.pptx');
assert.strictEqual(ctx.d({ url: '/uploads/a.pdf' }), null, 'pdf is not office');
assert.strictEqual(ctx.d({ url: '/uploads/../x.pptx' }).diskName, 'x.pptx', 'basename only');

const r1 = ctx.d({ _id: 'm2', url: 'https://res.cloudinary.com/x/raw/upload/v1/deck.PPTX?dl=1' });
assert.strictEqual(r1.kind, 'remote'); assert.ok(/^ro-[a-f0-9]{24}\.pptx$/.test(r1.diskName));
assert.ok(ctx.re.test(r1.diskName) && ctx.re.test(ctx.rn(r1.diskName)), 'derived names are guarded');
assert.strictEqual(ctx.d({ _id: 'm2', url: 'https://res.cloudinary.com/x/raw/upload/v1/deck.PPTX?dl=1' }).diskName, r1.diskName, 'stable');
assert.strictEqual(ctx.d({ url: 'https://drive.google.com/file/d/abc/view', fileName: 'Lecture.pptx' }).kind, 'remote', 'ext from fileName');
assert.strictEqual(ctx.d({ url: 'https://youtu.be/xyz' }), null, 'video link is not office');

const inl = ctx.d({ _id: 'm3', url: '', fileName: 'notes.docx', fileData: 'data:x;base64,AAAA' });
assert.strictEqual(inl.kind, 'inline'); assert.ok(/^ro-[a-f0-9]{24}\.docx$/.test(inl.diskName));
assert.strictEqual(ctx.d({ _id: 'm4', url: '', fileName: 'a.pdf', fileData: 'data:x;base64,AAAA' }), null);
assert.ok(!ctx.re.test('1789-ab12_pptx-render.pdf'), 'normal uploads are not "derived"');
console.log('✅ office render sources: passed');
