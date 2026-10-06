// Run: node scripts/test-certificate.js — validates the certificate template whitelist
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname, '..', 'server.js'),'utf8');
const a=src.indexOf('const CERT_DEFAULTS'), b=src.indexOf("app.get('/api/settings/certificate'");
const ctx={}; vm.createContext(ctx); vm.runInContext(src.slice(a,b)+';this.n=normalizeCertTemplate;this.D=CERT_DEFAULTS;',ctx);
const n=ctx.n;
let t=n({},null); assert.strictEqual(t.title,'Certificate'); assert.strictEqual(t.showCertId,true); assert.strictEqual(t.showSeal,false); assert.strictEqual(t.orientation,'landscape');
// legacy doc keeps its values
t=n({accentFrom:'#112233',logoEmoji:'🎓',showDate:false},null); assert.strictEqual(t.accentFrom,'#112233'); assert.strictEqual(t.logoEmoji,'🎓'); assert.strictEqual(t.showDate,false);
// bad inputs are rejected
t=n({}, {bgColor:'red;}</style><script>', borderStyle:'evil', logoUrl:'javascript:alert(1)', logoType:'image', title:'', showSeal:'yes', titleFont:'x'});
assert.strictEqual(t.bgColor,'#ffffff'); assert.strictEqual(t.borderStyle,'classic'); assert.strictEqual(t.logoUrl,''); assert.strictEqual(t.logoType,'emoji'); assert.strictEqual(t.title,'Certificate'); assert.strictEqual(t.showSeal,false); assert.strictEqual(t.titleFont,'playfair');
// good inputs accepted
t=n({}, {bgColor:'#0F172A', logoUrl:'/uploads/1700-logo.png', logoType:'image', showSeal:true, orientation:'portrait', nameFont:'greatvibes'});
assert.strictEqual(t.bgColor,'#0f172a'); assert.strictEqual(t.logoUrl,'/uploads/1700-logo.png'); assert.strictEqual(t.logoType,'image'); assert.strictEqual(t.showSeal,true); assert.strictEqual(t.orientation,'portrait'); assert.strictEqual(t.nameFont,'greatvibes');
// clearing an uploaded logo
t=n({logoUrl:'/uploads/a.png',logoType:'image'},{logoUrl:''}); assert.strictEqual(t.logoUrl,''); assert.strictEqual(t.logoType,'emoji');
// cloudinary ok, other hosts not
assert.strictEqual(n({}, {logoUrl:'https://res.cloudinary.com/demo/image/upload/v1/x.png'}).logoUrl,'https://res.cloudinary.com/demo/image/upload/v1/x.png');
assert.strictEqual(n({}, {logoUrl:'https://evil.com/x.png'}).logoUrl,'');
// text length bounded
assert.strictEqual(n({}, {orgName:'x'.repeat(500)}).orgName.length,80);
console.log('✅ certificate normaliser: passed');
