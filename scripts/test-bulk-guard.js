// Run: node scripts/test-bulk-guard.js
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname, '..', 'server.js'),'utf8');
const a=src.indexOf('const BULK_WINDOW_MS'), b=src.indexOf('function logMaterialAccess');
let updates=0; const ctx={console:{warn(){}},Date,Map,String,Math,User:{updateOne:()=>{updates++;return Promise.resolve();}},_isAdminUser:u=>u.role==='admin'};
vm.createContext(ctx); vm.runInContext(src.slice(a,b)+';this.c=checkBulkAccess;',ctx);
const u={_id:'u1',username:'s',role:'student'};
for(let i=0;i<29;i++) assert.strictEqual(ctx.c(u,'m'+i).paused,false);
assert.strictEqual(updates,0); ctx.c(u,'m29'); assert.strictEqual(updates,1,'flag at 30');
for(let i=0;i<5;i++) ctx.c(u,'m0');  // re-opening same material doesn't count
for(let i=30;i<59;i++) assert.strictEqual(ctx.c(u,'m'+i).paused,false);
assert.strictEqual(ctx.c(u,'m59').paused,true,'pause at 60');
assert.strictEqual(ctx.c(u,'x').paused,true,'still paused');
assert.strictEqual(ctx.c({_id:'a',role:'admin'},'x').paused,false,'admins never paused');
console.log('✅ bulk-access guard: passed');
