// Run: node scripts/test-ai-engine.js   (no network, no API keys — fake Gemini + Groq)
const assert = require('assert');
const path = require('path');
const { createAiEngine, _internals: I } = require(path.join(__dirname, '..', 'ai-engine.js'));

/* ---------- pure helpers ---------- */
const picked = I.pickGeminiModels(['gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-flash-latest', 'gemini-2.5-flash-preview-09-2025', 'gemini-2.5-flash-image',
  'gemini-embedding-001', 'gemini-2.5-flash-preview-tts', 'gemma-3-27b-it', 'gemini-3.5-flash-preview']).map(i => i.id);
assert.deepStrictEqual(picked.sort(), ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-preview'].sort());
assert.strictEqual(I.geminiEntry(I.geminiInfo('gemini-2.5-flash')).label, 'Gemini 2.5 Flash');
assert.strictEqual(I.geminiEntry(I.geminiInfo('gemini-3.1-pro-preview')).label, 'Gemini 3.1 Pro (preview)');
assert.strictEqual(I.prettyGroq('openai/gpt-oss-120b'), 'GPT-OSS 120B');
assert.strictEqual(I.prettyGroq('llama-3.3-70b-versatile'), 'Llama 3.3 70B');
assert.strictEqual(I.prettyGroq('qwen/qwen3.8-27b'), 'Qwen 3.8 27B');
assert.strictEqual(I.groqEntry('whisper-large-v3'), null);
assert.strictEqual(I.classify({ status: 429, message: '{"error":{"details":[{"retryDelay":"37s"}]}}' }).coolMs, 37000);
assert.strictEqual(I.classify({ status: 429, message: 'Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel' }).coolMs, 3600000);
assert.strictEqual(I.classify({ status: 429, message: 'Rate limit reached. Please try again in 7m12.5s.' }).coolMs, 432500);
assert.strictEqual(I.classify({ status: 401, message: 'bad key' }).kind, 'auth');
assert.strictEqual(I.classify({ status: 404, message: 'models/x is not found' }).kind, 'missing');
assert.strictEqual(I.classify({ status: 503, message: 'The model is overloaded' }).kind, 'down');
{ const s = I.thinkStripper(); let o = s('Hi <thi') + s('nk>secret</th') + s('ink> there') + s('', true); assert.strictEqual(o, 'Hi there'); }
{ const s = I.thinkStripper(); assert.strictEqual(s('a < b and x<t', false) + s('', true), 'a < b and x<t'); }
{ const m = I.toOpenAiMessages([{ role: 'user', parts: [{ text: 'q' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }] }, { role: 'model', parts: [{ text: 'a' }] }], 'sys', true);
  assert.strictEqual(m[0].role, 'system'); assert.strictEqual(m[1].content[1].image_url.url, 'data:image/png;base64,AAA'); assert.strictEqual(m[2].role, 'assistant'); }

/* ---------- fake providers ---------- */
let T = 1_000_000;
const now = () => T;
const behaviour = {};      // model → 'ok' | {status,message} | 'partial'
const calls = [];
const gemini = {
  models: {
    async list() { return (async function* () { for (const n of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview']) yield { name: 'models/' + n, supportedActions: ['generateContent'] }; })(); },
    async generateContentStream({ model }) {
      calls.push('gemini:' + model);
      const b = behaviour[model] || 'ok';
      if (b !== 'ok' && b !== 'partial') throw Object.assign(new Error(b.message), { status: b.status });
      return (async function* () {
        yield { text: 'Answer from ' + model + '. ', candidates: [{}] };
        yield { text: 'Done.', candidates: [{ finishReason: b === 'partial' ? 'MAX_TOKENS' : 'STOP' }] };
      })();
    }
  }
};
function sseBody(chunks) {
  const enc = new TextEncoder();
  return (async function* () { for (const c of chunks) yield enc.encode(c); })();
}
const fakeFetch = async (url, init) => {
  if (url.endsWith('/models')) {
    return { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }, { id: 'qwen/qwen3.8-27b' }, { id: 'old-model', active: false }] }) };
  }
  const body = JSON.parse(init.body);
  calls.push('groq:' + body.model);
  const b = behaviour[body.model] || 'ok';
  if (b !== 'ok') return { ok: false, status: b.status, headers: { get: (h) => h === 'retry-after' ? '20' : null }, json: async () => ({ error: { message: b.message } }) };
  assert.strictEqual(body.stream, true);
  if (body.model === 'qwen/qwen3.8-27b') assert.strictEqual(body.reasoning_format, 'hidden');
  return { ok: true, status: 200, body: sseBody([
    'data: {"choices":[{"delta":{"content":"<think>hmm</think>Groq "}}]}\n\ndata: {"choices":[{"delta":{"con',
    'tent":"answer from ' + body.model + '"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']) };
};
const quiet = { log() {}, warn() {}, error() {} };
const engine = createAiEngine({ env: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' }, getGeminiClient: () => gemini, fetch: fakeFetch, now, logger: quiet });

async function ask(pick, needs) {
  const cat = await engine.getCatalog();
  const plan = engine.buildChain(cat, pick, needs || {});
  let text = '';
  const r = await engine.run({ chain: plan.chain, contents: [{ role: 'user', parts: [{ text: 'hi' }] }], system: 's', temperature: 0.4, maxTokens: 100, onDelta: (t) => { text += t; } });
  return { r, text, plan };
}

(async () => {
  const cat = await engine.getCatalog();
  const ids = cat.map(e => e.id);
  assert.strictEqual(ids[0], 'gemini:gemini-2.5-flash', 'Auto starts with Flash, not Pro');
  assert.ok(ids.includes('groq:openai/gpt-oss-120b') && ids.includes('groq:qwen/qwen3.8-27b'));
  assert.ok(!ids.some(i => /whisper|old-model/.test(i)));
  assert.ok(ids.indexOf('groq:openai/gpt-oss-120b') < ids.indexOf('gemini:gemini-2.5-pro'), 'GPT-OSS before Pro in Auto');

  // 1. Auto works on Flash
  let { r, text } = await ask('auto');
  assert.strictEqual(r.used.id, 'gemini:gemini-2.5-flash'); assert.ok(/Answer from gemini-2.5-flash/.test(text));

  // 2. Flash rate-limited → falls to Groq GPT-OSS, Flash is cooled for 37 s and skipped next time
  behaviour['gemini-2.5-flash'] = { status: 429, message: 'RESOURCE_EXHAUSTED "retryDelay": "37s"' };
  calls.length = 0;
  ({ r, text } = await ask('auto'));
  assert.strictEqual(r.used.id, 'groq:openai/gpt-oss-120b'); assert.strictEqual(text, 'Groq answer from openai/gpt-oss-120b');
  calls.length = 0;
  ({ r } = await ask('auto'));
  assert.deepStrictEqual(calls, ['groq:openai/gpt-oss-120b'], 'cooled Flash is not retried');
  T += 38000;
  delete behaviour['gemini-2.5-flash'];
  ({ r } = await ask('auto'));
  assert.strictEqual(r.used.id, 'gemini:gemini-2.5-flash', 'Flash back after cool-down');

  // 3. explicit pick honoured
  ({ r, text } = await ask('groq:llama-3.3-70b-versatile'));
  assert.strictEqual(r.used.id, 'groq:llama-3.3-70b-versatile');
  ({ r } = await ask('gemini:gemini-2.5-pro'));
  assert.strictEqual(r.used.id, 'gemini:gemini-2.5-pro');

  // 4. picked text-only model + PDF attached → switched to a model that reads PDFs
  let out = await ask('groq:openai/gpt-oss-120b', { pdf: true });
  assert.strictEqual(out.plan.switched, 'pdf'); assert.strictEqual(out.r.used.provider, 'gemini');
  assert.ok(out.plan.chain.every(e => e.caps.pdf));

  // 5. picked model busy → note + fallback
  behaviour['gemini-2.5-pro'] = { status: 429, message: 'quota exceeded, limit: 0' };
  out = await ask('gemini:gemini-2.5-pro');
  assert.strictEqual(out.r.used.id, 'gemini:gemini-2.5-flash');
  out = await ask('gemini:gemini-2.5-pro');
  assert.strictEqual(out.plan.switched, 'busy');

  // 6. everything busy → friendly message with a wait time
  for (const m of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview']) behaviour[m] = { status: 429, message: 'RESOURCE_EXHAUSTED retryDelay: "50s"' };
  for (const m of ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b']) behaviour[m] = { status: 429, message: 'Rate limit reached' };
  T += 120000;
  out = await ask('auto');
  assert.strictEqual(out.r.used, null);
  const fm = engine.failureMessage(out.r, out.plan.chain);
  assert.ok(/busy/.test(fm.message) && fm.retryAfter > 0, fm.message);

  // 7. Groq key rejected → whole provider rests, Gemini still answers
  Object.keys(behaviour).forEach(k => delete behaviour[k]);
  T += 3 * 3600 * 1000;
  const e2 = createAiEngine({ env: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'bad' }, getGeminiClient: () => gemini, fetch: fakeFetch, now, logger: quiet });
  behaviour['openai/gpt-oss-120b'] = { status: 401, message: 'Invalid API Key' };
  const c2 = await e2.getCatalog();
  let p2 = e2.buildChain(c2, 'groq:openai/gpt-oss-120b', {});
  let r2 = await e2.run({ chain: p2.chain, contents: [{ role: 'user', parts: [{ text: 'x' }] }], system: 's', temperature: 0, maxTokens: 10, onDelta() {} });
  assert.strictEqual(r2.used.provider, 'gemini');
  assert.ok(c2.filter(e => e.provider === 'groq').every(e => e2.coolLeft(e) > 0), 'all Groq models rest after auth failure');

  // 8. only Groq configured
  const e3 = createAiEngine({ env: { GROQ_API_KEY: 'q' }, fetch: fakeFetch, now, logger: quiet });
  const l3 = await e3.publicList();
  assert.ok(l3.models.length >= 2 && l3.models.every(m => m.provider === 'groq') && l3.providers.gemini === false);
  // image question with only text models → no capable model
  assert.strictEqual(e3.buildChain(await e3.getCatalog(), 'auto', { images: true }).chain.length, 0);

  // 9. AI_MODELS forces the list and order
  const e4 = createAiEngine({ env: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', AI_MODELS: 'llama-3.3-70b-versatile, gemini-2.5-pro' }, getGeminiClient: () => gemini, fetch: fakeFetch, now, logger: quiet });
  assert.deepStrictEqual((await e4.getCatalog()).map(e => e.id), ['groq:llama-3.3-70b-versatile', 'gemini:gemini-2.5-pro']);

  // 10. partial answer (MAX_TOKENS) is reported as partial
  behaviour['gemini-2.5-flash'] = 'partial';
  const e5 = createAiEngine({ env: { GEMINI_API_KEY: 'g' }, getGeminiClient: () => gemini, now, logger: quiet });
  const p5 = e5.buildChain(await e5.getCatalog(), 'auto', {});
  const r5 = await e5.run({ chain: p5.chain, contents: [{ role: 'user', parts: [{ text: 'x' }] }], system: 's', temperature: 0, maxTokens: 10, onDelta() {} });
  assert.strictEqual(r5.partial, true);

  // 11. health check
  Object.keys(behaviour).forEach(k => delete behaviour[k]);
  const res = await engine.testAll();
  assert.ok(res.length === cat.length && res.every(x => x.ok), JSON.stringify(res));

  console.log('✅ ai engine: all checks passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
