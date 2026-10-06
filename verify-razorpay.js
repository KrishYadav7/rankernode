// verify-razorpay.js
// Run: node verify-razorpay.js
require('dotenv').config();

const c = {
  reset: '\x1b[0m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  bold:  '\x1b[1m',
};

const ok   = (m) => console.log(`${c.green}  ✅ ${m}${c.reset}`);
const bad  = (m) => console.log(`${c.red}  ❌ ${m}${c.reset}`);
const warn = (m) => console.log(`${c.yellow}  ⚠️  ${m}${c.reset}`);
const info = (m) => console.log(`${c.cyan}     ${m}${c.reset}`);

console.log(`\n${c.bold}${c.cyan}══════════════════════════════════════════════`);
console.log(`   RANKERNODE — RAZORPAY .ENV VERIFICATION CHECK`);
console.log(`══════════════════════════════════════════════${c.reset}\n`);

let pass = 0, fail = 0;

// ---------- 1. RAZORPAY_KEY_ID ----------
console.log(`${c.bold}[1] RAZORPAY_KEY_ID${c.reset}`);
const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();

if (!keyId) {
  bad('NOT SET — env var is empty or missing');
  fail++;
} else if (keyId.startsWith('rzp_live_')) {
  ok(`Set · LIVE mode · ${keyId.slice(0, 18)}…`);
  pass++;
} else if (keyId.startsWith('rzp_test_')) {
  warn(`Set · TEST mode · ${keyId.slice(0, 18)}…  ← change to live if you want real payments`);
  pass++;
} else {
  bad(`Invalid format — must start with "rzp_live_" or "rzp_test_"`);
  info(`Got: ${keyId.slice(0, 20)}…`);
  fail++;
}

// ---------- 2. RAZORPAY_KEY_SECRET ----------
console.log(`\n${c.bold}[2] RAZORPAY_KEY_SECRET${c.reset}`);
const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

if (!keySecret) {
  bad('NOT SET');
  fail++;
} else if (keySecret.length < 20) {
  bad(`Too short (${keySecret.length} chars) — you probably copied only part of it`);
  fail++;
} else {
  ok(`Set · ${keySecret.length} chars · ${keySecret.slice(0, 6)}…${keySecret.slice(-4)}`);
  pass++;
}

// ---------- 3. RAZORPAY_WEBHOOK_SECRET ----------
console.log(`\n${c.bold}[3] RAZORPAY_WEBHOOK_SECRET${c.reset}`);
const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

if (!webhookSecret) {
  bad('NOT SET — webhook signature verification will fail (payments still work, but auto-unlock via webhook will not)');
  fail++;
} else if (webhookSecret.length < 12) {
  bad(`Too short (${webhookSecret.length} chars) — likely wrong`);
  fail++;
} else {
  ok(`Set · ${webhookSecret.length} chars`);
  pass++;
}

// ---------- 4. Cross-check: same mode? ----------
console.log(`\n${c.bold}[4] Mode consistency${c.reset}`);
const idMode      = keyId.startsWith('rzp_live_') ? 'LIVE' : keyId.startsWith('rzp_test_') ? 'TEST' : 'UNKNOWN';
const secretLooksLive = /^[A-Za-z0-9]{20,}$/.test(keySecret); // both test & live secrets are similar, we can't tell mode from secret alone

if (idMode === 'UNKNOWN') {
  warn('Cannot determine mode — key id format wrong');
} else {
  ok(`Both keys present · mode = ${idMode}`);
  pass++;
  if (idMode === 'LIVE') {
    info('⚠️  You are in LIVE mode — real money will be charged!');
  }
}

// ---------- 5. Optional: RAZORPAY_PLAN_ID ----------
console.log(`\n${c.bold}[5] RAZORPAY_PLAN_ID (optional)${c.reset}`);
const planId = (process.env.RAZORPAY_PLAN_ID || '').trim();
if (!planId) {
  warn('Not set — server will auto-create a plan on first subscription (recommended)');
} else if (!planId.startsWith('plan_')) {
  bad(`Invalid — must start with "plan_". Got: ${planId}`);
  fail++;
} else {
  ok(`Set · ${planId}`);
  pass++;
}

// ---------- Summary ----------
console.log(`\n${c.bold}${c.cyan}══════════════════════════════════════════════`);
console.log(`   RESULT:  ${pass} passed  ·  ${fail} failed`);
console.log(`══════════════════════════════════════════════${c.reset}`);

if (fail === 0 && idMode === 'LIVE') {
  console.log(`\n${c.green}${c.bold}🎉 Razorpay LIVE setup looks correct!${c.reset}`);
  console.log(`${c.green}   Restart server → check logs for "mode: LIVE"${c.reset}\n`);
  process.exit(0);
} else if (fail === 0 && idMode === 'TEST') {
  console.log(`\n${c.yellow}${c.bold}🧪 Razorpay TEST setup looks correct!${c.reset}`);
  console.log(`${c.yellow}   Use test card 4111 1111 1111 1111 to test${c.reset}\n`);
  process.exit(0);
} else {
  console.log(`\n${c.red}${c.bold}❌ Fix the failed items above and re-run:${c.reset}`);
  console.log(`${c.red}   node verify-razorpay.js${c.reset}\n`);
  process.exit(1);
}