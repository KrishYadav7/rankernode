// Run: node scripts/test-ai-continue.js — long answers are continued, oversized token budgets are shrunk
const assert = require('assert');
const { createAiEngine } = require(require('path').join(__dirname, '..', 'ai-engine.js'));
const quiet = { log() {}, warn() {}, error() {} };
let geminiCalls = [];
const gemini = { models: {
  async list() { return (async function* () { yield { name: 'models/gemini-2.5-flash' }; })(); },
  async generateContentStream({ model, contents, config }) {
    geminiCalls.push({ n: contents.length, max: config.maxOutputTokens, last: contents[contents.length - 1].parts[0].text });
    const part = geminiCalls.length;
    return (async function* () {
      yield { text: `part${part}`, candidates: [{ finishReason: part < 3 ? 'MAX_TOKENS' : 'STOP' }] };
    })();
  } } };
(async () => {
  const e = createAiEngine({ env: { GEMINI_API_KEY: 'x' }, getGeminiClient: () => gemini, logger: quiet });
  const cat = await e.getCatalog();
  let text = '';
  const r = await e.run({ chain: e.buildChain(cat, 'auto', {}).chain, contents: [{ role: 'user', parts: [{ text: 'q' }] }], system: 's', temperature: 0.4, maxTokens: 8192, onDelta: t => text += t });
  assert.strictEqual(text, 'part1 part2 part3');
  assert.strictEqual(r.partial, false); assert.strictEqual(r.continues, 2);
  assert.strictEqual(geminiCalls[0].max, 24576, 'Gemini gets a 24k budget (thinking counts)');
  assert.strictEqual(geminiCalls[1].n, 3); assert.ok(/Continue exactly/.test(geminiCalls[1].last));

  // Groq: TPM error → retried once with a smaller budget
  const bodies = [];
  const fetch = async (url, init) => {
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-oss-120b' }] }) };
    const b = JSON.parse(init.body); bodies.push(b.max_completion_tokens);
    if (bodies.length === 1) return { ok: false, status: 413, headers: { get: () => null }, json: async () => ({ error: { message: 'Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9500, please reduce your message size and try again.' } }) };
    const enc = new TextEncoder();
    return { ok: true, status: 200, body: (async function* () { yield enc.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); })() };
  };
  const g = createAiEngine({ env: { GROQ_API_KEY: 'k' }, fetch, logger: quiet });
  const gc = await g.getCatalog();
  let out = '';
  const r2 = await g.run({ chain: g.buildChain(gc, 'auto', {}).chain, contents: [{ role: 'user', parts: [{ text: 'q' }] }], system: 's', temperature: 0.4, maxTokens: 8192, onDelta: t => out += t });
  assert.strictEqual(out, 'ok'); assert.strictEqual(r2.used.model, 'openai/gpt-oss-120b');
  assert.deepStrictEqual(bodies, [8192, 8192 - 1500 - 256]);
  console.log('✅ ai continue + token budget: passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
