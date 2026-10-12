'use strict';
/* ============================================================
   ⭐ RankerNode AI ENGINE v3 (2026-10-08)
   ------------------------------------------------------------
   • Two providers: Google Gemini (GEMINI_API_KEY) and Groq
     (GROQ_API_KEY, OpenAI-compatible). Either one alone works.
   • Model catalog discovered from each provider (cached 10 min),
     turned into friendly picker entries ("Gemini 2.5 Flash", …).
   • "Auto" = Flash first (generous free quota, reads images/PDFs),
     then the strongest Groq model, then Pro, then lighter models.
     (v2 tried only the top 4 by name — all "Pro" variants with a
     tiny free quota — so every answer failed with "rate limit".)
   • A model that answers 429 / quota is put on a cool-down for the
     time the provider asks for, so the next question skips it
     instantly instead of failing again.
   • Picked model busy / can't read the attachment → the next best
     model answers and the student is told which one did.
   No npm dependencies — Groq is called with the built-in fetch.
   ============================================================ */

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const MAX_CHAIN = 5;

/* ---------- Gemini: which listed models are chat models ---------- */
const GEMINI_SKIP = /(tts|image|embedding|live|audio|veo|imagen|aqa|robotics|computer-use|learnlm|gemma|nano|native|customtools|omni)/i;
function geminiInfo(id) {
  id = String(id || '').replace(/^models\//, '');
  if (!id || GEMINI_SKIP.test(id)) return null;
  const m = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)(?:-(.+))?$/i.exec(id);
  if (!m) return null;                                   // aliases like gemini-flash-latest are skipped
  const suffix = (m[3] || '').toLowerCase();
  let stage;
  if (!suffix) stage = 'stable';
  else if (/^(preview|exp)/.test(suffix)) stage = 'preview';
  else return null;                                      // -001, -thinking, … duplicates
  return { id, version: parseFloat(m[1]) || 0, family: m[2].toLowerCase(), stage, dated: /\d{2}-\d{2,4}/.test(suffix) };
}

const GEMINI_FAMILY = {
  flash: { name: 'Flash', desc: 'Fast and smart · reads images & PDFs', tags: ['fast', 'files'], rank: 100 },
  pro:   { name: 'Pro', desc: 'Deepest reasoning for hard derivations · slower, small free quota', tags: ['reasoning', 'files'], rank: 70 },
  'flash-lite': { name: 'Flash-Lite', desc: 'Quickest Gemini, for short questions · reads images & PDFs', tags: ['fast', 'files'], rank: 55 }
};

function pickGeminiModels(ids) {
  const infos = ids.map(geminiInfo).filter(Boolean);
  const out = [];
  for (const fam of Object.keys(GEMINI_FAMILY)) {
    const list = infos.filter(i => i.family === fam);
    const best = (arr) => arr.sort((a, b) => b.version - a.version || Number(a.dated) - Number(b.dated) || a.id.length - b.id.length)[0];
    const stable = best(list.filter(i => i.stage === 'stable'));
    const preview = best(list.filter(i => i.stage === 'preview' && (!stable || i.version > stable.version)));
    if (stable) out.push(stable);
    if (preview) out.push(preview);
  }
  return out;
}

function geminiEntry(info) {
  const f = GEMINI_FAMILY[info.family];
  const v = Number.isInteger(info.version) ? info.version.toFixed(0) : String(info.version);
  const preview = info.stage === 'preview';
  return {
    id: 'gemini:' + info.id, provider: 'gemini', model: info.id,
    label: `Gemini ${v} ${f.name}${preview ? ' (preview)' : ''}`,
    desc: f.desc + (preview ? ' · preview, may be unavailable' : ''),
    group: 'Google Gemini',
    caps: { images: true, pdf: true },
    tags: f.tags.slice(),
    autoRank: f.rank + Math.min(info.version, 9) / 10 - (preview ? 25 : 0)
  };
}

/* ---------- Groq: known chat models (anything else is ignored) ---------- */
function prettyGroq(id) {
  let n = String(id).split('/').pop();
  n = n.replace(/-(instant|versatile|instruct|it)$/i, '').replace(/-\d{4}$/, '');
  return n.split('-').map(w => /^\d+(\.\d+)?[bm]$/i.test(w) ? w.toUpperCase()
    : /^qwen(\d.*)$/i.test(w) ? 'Qwen ' + w.slice(4)
    : /^gpt$/i.test(w) ? 'GPT' : /^oss$/i.test(w) ? 'OSS'
    : w.charAt(0).toUpperCase() + w.slice(1)).join(' ').replace('GPT OSS', 'GPT-OSS');
}
const GROQ_KNOWN = [
  { re: /^openai\/gpt-oss-120b$/i, desc: 'Strong step-by-step reasoning · very fast · text only', tags: ['reasoning', 'fast'], rank: 90, extra: { reasoning_effort: 'medium' } },
  { re: /^moonshotai\/kimi-k2/i, desc: 'Careful long explanations · text only', tags: ['reasoning'], rank: 78 },
  { re: /^qwen\/qwen3/i, desc: 'Good at maths & derivations · text only', tags: ['reasoning'], rank: 76, extra: { reasoning_format: 'hidden' } },
  { re: /^minimaxai\/minimax/i, desc: 'Long, detailed answers · text only', tags: ['reasoning'], rank: 73 },
  { re: /^llama-3\.3-70b/i, desc: 'Clear explanations · very fast · text only', tags: ['fast'], rank: 72 },
  { re: /^meta-llama\/llama-4-maverick/i, desc: 'Fast · reads images (not PDFs)', tags: ['fast', 'images'], rank: 68, vision: true },
  { re: /^meta-llama\/llama-4-scout/i, desc: 'Fast · reads images (not PDFs)', tags: ['fast', 'images'], rank: 62, vision: true },
  { re: /^openai\/gpt-oss-20b$/i, desc: 'Quick reasoning for simpler problems · text only', tags: ['fast'], rank: 60, extra: { reasoning_effort: 'medium' } },
  { re: /^llama-3\.1-8b-instant$/i, desc: 'Instant answers to simple questions · text only', tags: ['fast'], rank: 40 }
];
function groqEntry(id) {
  const k = GROQ_KNOWN.find(x => x.re.test(id));
  if (!k) return null;
  return {
    id: 'groq:' + id, provider: 'groq', model: id,
    label: prettyGroq(id), desc: k.desc, group: 'Groq · open models',
    caps: { images: !!k.vision, pdf: false },
    tags: k.tags.slice(), autoRank: k.rank, extra: k.extra || null
  };
}

const STATIC_GEMINI = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
const STATIC_GROQ = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

/* ---------- error → kind + how long to rest the model ---------- */
function retryMsFrom(err) {
  const msg = String((err && err.message) || '');
  let s = null;
  const ra = err && err.retryAfter != null ? parseFloat(err.retryAfter) : NaN;
  if (Number.isFinite(ra)) s = ra;
  let m = /retryDelay["'\s:]*["']?(\d+(?:\.\d+)?)s/i.exec(msg) || /retry in (\d+(?:\.\d+)?)\s*s/i.exec(msg);
  if (s == null && m) s = parseFloat(m[1]);
  m = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i.exec(msg);
  if (s == null && m && (m[1] || m[2] || m[3])) s = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (parseFloat(m[3]) || 0);
  let ms = (s != null ? s : 60) * 1000;
  if (/per ?day|PerDay|RPD|TPD|daily/i.test(msg)) ms = Math.max(ms, 60 * 60 * 1000);
  return Math.max(10 * 1000, Math.min(12 * 60 * 60 * 1000, ms));
}
function classify(err) {
  const msg = String((err && err.message) || err || '');
  let status = Number(err && (err.status || err.statusCode || (err.error && err.error.code) || err.code)) || 0;
  if (!status) { const m = /"code"\s*:\s*(\d{3})/.exec(msg); if (m) status = +m[1]; }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit|too many requests/i.test(msg)) return { kind: 'busy', status, coolMs: retryMsFrom(err), msg };
  if (status === 401 || status === 403 || /API key|API_KEY_INVALID|PERMISSION_DENIED|ACCESS_TOKEN_TYPE_UNSUPPORTED|invalid_api_key|unauthori[sz]ed/i.test(msg)) return { kind: 'auth', status, coolMs: 10 * 60 * 1000, msg };
  if (status === 404 || /not found|decommissioned|does not exist|model_not_found|no longer (?:available|supported)/i.test(msg)) return { kind: 'missing', status, coolMs: 24 * 60 * 60 * 1000, msg };
  if (status >= 500 || /UNAVAILABLE|overloaded|INTERNAL|deadline|timed? ?out/i.test(msg)) return { kind: 'down', status, coolMs: 45 * 1000, msg };
  if (/network|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket/i.test(msg)) return { kind: 'network', status, coolMs: 0, msg };
  if (status === 413 || /too large|payload size|exceeds the maximum|context length|maximum context/i.test(msg)) return { kind: 'toolarge', status, coolMs: 0, msg };
  if (/safety|blocked/i.test(msg)) return { kind: 'safety', status, coolMs: 0, msg };
  return { kind: status === 400 ? 'bad' : 'error', status, coolMs: 0, msg };
}

/* strips <think>…</think> that some open models emit inside the answer */
function thinkStripper() {
  let inThink = false, pend = '';
  const OPEN = '<think>', CLOSE = '</think>';
  const holdback = (s, tag) => { for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) return k; return 0; };
  return function (t, flush) {
    pend += t || '';
    let out = '';
    for (;;) {
      if (inThink) {
        const i = pend.indexOf(CLOSE);
        if (i < 0) { pend = flush ? '' : pend.slice(-(CLOSE.length - 1)); return out; }
        pend = pend.slice(i + CLOSE.length).replace(/^\s+/, ''); inThink = false;
      } else {
        const i = pend.indexOf(OPEN);
        if (i >= 0) { out += pend.slice(0, i); pend = pend.slice(i + OPEN.length); inThink = true; continue; }
        const k = flush ? 0 : holdback(pend, OPEN);
        out += pend.slice(0, pend.length - k); pend = pend.slice(pend.length - k);
        return out;
      }
    }
  };
}

/* Gemini-style contents → OpenAI chat messages */
function toOpenAiMessages(contents, system, vision) {
  const msgs = [{ role: 'system', content: system }];
  for (const c of contents || []) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const texts = [], imgs = [];
    for (const p of c.parts || []) {
      if (p && typeof p.text === 'string') texts.push(p.text);
      else if (p && p.inlineData && vision && /^image\//.test(p.inlineData.mimeType || '')) imgs.push(p.inlineData);
    }
    const text = texts.join('\n').trim();
    if (imgs.length && role === 'user') {
      msgs.push({ role, content: [{ type: 'text', text: text || 'Please solve the question in the image.' }]
        .concat(imgs.slice(0, 5).map(d => ({ type: 'image_url', image_url: { url: `data:${d.mimeType};base64,${d.data}` } }))) });
    } else if (text) {
      msgs.push({ role, content: text });
    }
  }
  return msgs;
}

function createAiEngine(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const log = opts.logger || console;
  const getGemini = opts.getGeminiClient;
  const doFetch = opts.fetch || ((...a) => fetch(...a));
  const clock = opts.now || (() => Date.now());
  const groqBase = String(env.GROQ_BASE_URL || GROQ_BASE).replace(/\/+$/, '');
  const cool = new Map();                 // entry id or 'provider:x' → { until, kind }
  let cache = null;                       // { at, list, errors }
  let loading = null;

  const hasGemini = () => !!String(env.GEMINI_API_KEY || '').trim() && typeof getGemini === 'function';
  const hasGroq = () => !!String(env.GROQ_API_KEY || '').trim();
  const configured = () => hasGemini() || hasGroq();

  function coolLeft(e) {
    const t = clock();
    const a = cool.get(e.id), b = cool.get('provider:' + e.provider);
    const left = Math.max(a && a.until > t ? a.until - t : 0, b && b.until > t ? b.until - t : 0);
    return left;
  }
  function setCool(key, ms, kind) { if (ms > 0) cool.set(key, { until: clock() + ms, kind }); }
  function clearCool(e) { cool.delete(e.id); }

  async function discoverGemini() {
    const ids = [];
    const listResp = await getGemini().models.list();
    for await (const m of listResp) {
      const methods = m.supportedActions || m.supportedGenerationMethods || [];
      const ok = Array.isArray(methods) && methods.length ? methods.some(x => /generateContent/i.test(x)) : true;
      if (ok) ids.push(String(m.name || '').replace(/^models\//, ''));
    }
    return ids;
  }
  async function discoverGroq() {
    const res = await doFetch(groqBase + '/models', { headers: { Authorization: 'Bearer ' + String(env.GROQ_API_KEY).trim() } });
    if (!res.ok) throw Object.assign(new Error('Groq model list HTTP ' + res.status), { status: res.status });
    const j = await res.json();
    return (j.data || []).filter(m => m && m.id && m.active !== false).map(m => m.id);
  }

  async function getCatalog(force) {
    if (!force && cache && clock() - cache.at < CATALOG_TTL_MS) return cache.list;
    if (loading) return loading;
    loading = (async () => {
      const list = [], errors = {};
      const forced = String(env.AI_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (hasGemini()) {
        let ids;
        try { ids = await discoverGemini(); if (!ids.length) throw new Error('no models listed'); }
        catch (e) { errors.gemini = e.message; log.warn('[ai] Gemini model list failed, using defaults:', e.message); ids = STATIC_GEMINI; }
        pickGeminiModels(ids).forEach(i => list.push(geminiEntry(i)));
        if (!list.length) STATIC_GEMINI.map(geminiInfo).forEach(i => list.push(geminiEntry(i)));
      }
      if (hasGroq()) {
        let ids;
        try { ids = await discoverGroq(); }
        catch (e) { errors.groq = e.message; log.warn('[ai] Groq model list failed, using defaults:', e.message); ids = STATIC_GROQ; }
        const before = list.length;
        ids.map(groqEntry).filter(Boolean).forEach(e => list.push(e));
        if (list.length === before) STATIC_GROQ.map(groqEntry).forEach(e => list.push(e));
      }
      /* AI_MODELS=gemini-2.5-flash,openai/gpt-oss-120b → only these, in this order */
      let final = list;
      if (forced.length) {
        final = [];
        forced.forEach((name, i) => {
          const hit = list.find(e => e.model === name || e.id === name)
            || (geminiInfo(name) ? geminiEntry(geminiInfo(name)) : null) || groqEntry(name);
          if (hit && !final.some(e => e.id === hit.id)) final.push(Object.assign({}, hit, { autoRank: 1000 - i }));
        });
      }
      final.sort((a, b) => b.autoRank - a.autoRank);
      cache = { at: clock(), list: final, errors };
      log.log('[ai] models:', final.map(e => e.id).join(', ') || '(none)');
      return final;
    })();
    try { return await loading; } finally { loading = null; }
  }

  /* needs: { images, pdf } — what the request's attachments require */
  function buildChain(catalog, pickedId, needs) {
    needs = needs || {};
    const capable = (e) => (!needs.pdf || e.caps.pdf) && (!needs.images || e.caps.images);
    const pool = catalog.filter(capable).slice().sort((a, b) => b.autoRank - a.autoRank);
    let picked = null, switched = null;
    if (pickedId && pickedId !== 'auto') {
      picked = catalog.find(e => e.id === pickedId) || null;
      if (!picked) switched = 'unavailable';
      else if (!capable(picked)) { switched = needs.pdf ? 'pdf' : 'images'; picked = null; }
      else if (coolLeft(picked) > 0) switched = 'busy';
    }
    const ordered = picked ? [picked].concat(pool.filter(e => e !== picked)) : pool;
    const warm = ordered.filter(e => coolLeft(e) === 0);
    const cold = ordered.filter(e => coolLeft(e) > 0).sort((a, b) => coolLeft(a) - coolLeft(b));
    return { chain: warm.concat(cold).slice(0, MAX_CHAIN), picked, switched, requested: pickedId && pickedId !== 'auto' ? (catalog.find(e => e.id === pickedId) || null) : null };
  }

  async function* streamGemini(e, req) {
    const stream = await getGemini().models.generateContentStream({
      model: e.model, contents: req.contents,
      config: { systemInstruction: req.system, temperature: req.temperature, maxOutputTokens: req.maxTokens, abortSignal: req.signal }
    });
    for await (const chunk of stream) {
      let t = '';
      try { t = chunk && chunk.text; } catch (_) { t = ''; }
      const c0 = chunk && chunk.candidates && chunk.candidates[0];
      let finish = c0 && c0.finishReason ? String(c0.finishReason) : '';
      if (!t && chunk && chunk.promptFeedback && chunk.promptFeedback.blockReason) finish = 'SAFETY';
      if (finish === 'MAX_TOKENS') finish = 'length';
      if (/SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(finish)) finish = 'SAFETY';
      yield { text: t || '', finish };
    }
  }

  async function* streamGroq(e, req, noExtra) {
    const body = Object.assign({
      model: e.model,
      messages: toOpenAiMessages(req.contents, req.system, e.caps.images),
      temperature: req.temperature,
      max_completion_tokens: req.maxTokens,
      stream: true
    }, noExtra ? {} : (e.extra || {}));
    const res = await doFetch(groqBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + String(env.GROQ_API_KEY).trim() },
      body: JSON.stringify(body), signal: req.signal
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (_) {}
      const err = Object.assign(new Error(msg), { status: res.status, retryAfter: res.headers && res.headers.get && res.headers.get('retry-after') });
      if (res.status === 400 && !noExtra && e.extra && /reasoning|unsupported|unknown|not supported/i.test(msg)) {
        yield* streamGroq(e, req, true);                   // retry once without the model-specific options
        return;
      }
      throw err;
    }
    const strip = thinkStripper();
    const dec = new TextDecoder();
    let buf = '';
    const handle = (line) => {
      line = line.trim();
      if (!line.startsWith('data:')) return null;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return null;
      let j; try { j = JSON.parse(data); } catch (_) { return null; }
      if (j.error) throw Object.assign(new Error(j.error.message || 'stream error'), { status: j.error.code === 'rate_limit_exceeded' ? 429 : 500 });
      const ch = j.choices && j.choices[0];
      if (!ch) return null;
      return { text: strip((ch.delta && ch.delta.content) || ''), finish: ch.finish_reason === 'length' ? 'length' : (ch.finish_reason === 'content_filter' ? 'SAFETY' : (ch.finish_reason || '')) };
    };
    for await (const chunk of res.body) {
      buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const ev = handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (ev) yield ev;
      }
    }
    if (buf.trim()) { const ev = handle(buf); if (ev) yield ev; }
    const tail = strip('', true);
    if (tail) yield { text: tail, finish: '' };
  }

  /* How many tokens a model may write. Gemini 2.5+ counts its hidden
     "thinking" inside maxOutputTokens, so 8192 cut long answers short;
     these models allow 65k. Groq's free tier counts max tokens against a
     per-minute budget, so it stays at 8192 (shrunk further if Groq asks). */
  function tokensFor(e, req) {
    if (e.provider === 'gemini') return req.geminiMaxTokens || Math.max(req.maxTokens || 0, 24576);
    return Math.min(req.maxTokens || 8192, req.groqMaxTokens || 8192);
  }
  /* Model refused the size → a smaller budget it will accept (or 0) */
  function shrinkTokens(err, cur) {
    const msg = String((err && err.message) || '');
    const st = Number(err && (err.status || err.statusCode)) || 0;
    const m = /Limit\s*(\d+)\s*,\s*Requested\s*(\d+)/i.exec(msg);
    if (m) {                                            // Groq TPM: "Limit 8000, Requested 9234"
      const next = cur - (Number(m[2]) - Number(m[1])) - 256;
      return next >= 1024 && next < cur ? next : 0;
    }
    if ((st === 400 || st === 413) && /max_?output_?tokens|maxOutputTokens|max_completion_tokens|max_tokens|output token/i.test(msg) && cur > 8192) return 8192;
    return 0;
  }

  /* Tries the chain in order. Calls onModel(entry, index) before each
     attempt and onDelta(text) for every piece of the answer.
     ⭐ If a model stops because it hit its length limit, it is asked to
     continue (up to req.autoContinue times, default 2) and the extra
     text streams on seamlessly — the student gets the whole answer. */
  async function run(req) {
    const attempts = [];
    let lastError = null;
    const maxContinues = req.autoContinue == null ? 2 : req.autoContinue;
    for (let i = 0; i < req.chain.length; i++) {
      const e = req.chain[i];
      if (req.signal && req.signal.aborted) break;
      if (req.onModel) { try { req.onModel(e, i); } catch (_) {} }
      let got = 0, finish = '', answer = '', continues = 0, shrunk = false;
      let maxTokens = tokensFor(e, req);
      let contents = req.contents;
      const t0 = clock();
      try {
        for (;;) {
          let partGot = 0;
          finish = '';
          try {
            const sub = Object.assign({}, req, { contents, maxTokens });
            const gen = e.provider === 'groq' ? streamGroq(e, sub) : streamGemini(e, sub);
            for await (const ev of gen) {
              if (req.signal && req.signal.aborted) break;
              if (ev.text) { got += ev.text.length; partGot += ev.text.length; answer += ev.text; req.onDelta(ev.text); }
              if (ev.finish) finish = ev.finish;
            }
          } catch (err) {
            /* too big a token budget → retry this model once with a smaller one */
            const smaller = !partGot && !shrunk && !(req.signal && req.signal.aborted) ? shrinkTokens(err, maxTokens) : 0;
            if (smaller) { shrunk = true; maxTokens = smaller; log.warn(`[ai] ${e.id}: retrying with max ${smaller} tokens`); continue; }
            throw err;
          }
          if (req.signal && req.signal.aborted) return { used: got ? e : null, partial: true, aborted: true, attempts, lastError };
          if (finish === 'length' && partGot && continues < maxContinues) {
            continues++;
            contents = req.contents.concat([
              { role: 'model', parts: [{ text: answer }] },
              { role: 'user', parts: [{ text: 'Continue exactly from where you stopped. Do not repeat anything you already wrote and do not add an introduction — just continue the answer.' }] }
            ]);
            if (!/\s$/.test(answer)) { req.onDelta(' '); answer += ' '; }
            log.log(`[ai] ${e.id}: answer hit the length limit — continuing (${continues}/${maxContinues})`);
            continue;
          }
          break;
        }
        if (got) {
          clearCool(e);
          attempts.push({ id: e.id, ok: true, ms: clock() - t0, continues });
          return { used: e, partial: finish === 'length', attempts, lastError, continues };
        }
        lastError = { entry: e, kind: finish === 'SAFETY' ? 'safety' : 'empty', msg: finish === 'SAFETY' ? 'blocked by safety' : 'empty response' };
        attempts.push({ id: e.id, ok: false, kind: lastError.kind });
        if (finish === 'SAFETY') break;                       // another model would refuse too
      } catch (err) {
        if (req.signal && req.signal.aborted) return { used: got ? e : null, partial: true, aborted: true, attempts, lastError };
        const info = classify(err);
        lastError = Object.assign({ entry: e }, info);
        attempts.push({ id: e.id, ok: false, kind: info.kind, status: info.status });
        log.error(`[ai] ❌ ${e.id} → ${info.kind}${info.status ? ' ' + info.status : ''}: ${info.msg.slice(0, 240)}`);
        if (info.kind === 'auth') setCool('provider:' + e.provider, info.coolMs, 'auth');
        else setCool(e.id, info.coolMs, info.kind);
        if (info.kind === 'missing' && cache) cache.at = 0;    // re-discover models next time
        if (got) return { used: e, partial: true, attempts, lastError };   // keep what was already written
      }
    }
    return { used: null, attempts, lastError };
  }

  /* Student-facing message when nothing could answer */
  function failureMessage(result, chain) {
    const att = (result && result.attempts) || [];
    const le = result && result.lastError;
    if (!configured()) return { message: 'AI is not configured. Please ask the admin to set GEMINI_API_KEY or GROQ_API_KEY.' };
    if (att.length && att.every(a => a.kind === 'busy' || a.kind === 'down')) {
      const waits = (chain || []).map(coolLeft).filter(x => x > 0);
      const sec = waits.length ? Math.ceil(Math.min.apply(null, waits) / 1000) : 60;
      const when = sec >= 90 ? `about ${Math.ceil(sec / 60)} min` : `${sec} seconds`;
      return { message: `All AI models are busy right now (free usage limit reached). Please try again in ${when}, or pick another model.`, retryAfter: sec };
    }
    if (!le) return { message: 'AI is temporarily unavailable. Please try again in a moment.' };
    switch (le.kind) {
      case 'auth':     return { message: 'The AI service rejected the server\'s API key. Please ask the admin to check GEMINI_API_KEY / GROQ_API_KEY.' };
      case 'toolarge': return { message: 'The attachments are too large for the AI. Try fewer pages or smaller images.' };
      case 'safety':   return { message: 'The AI declined to answer this request. Please rephrase your question.' };
      case 'network':  return { message: 'Network error reaching the AI service. Please try again.' };
      case 'bad':      return { message: 'The AI could not process that request. Try rephrasing, or attach the file as a PDF or image.' };
      case 'missing':  return { message: 'That AI model is no longer available. Please pick another model.' };
      default:         return { message: 'AI is temporarily unavailable. Please try again in a moment.' };
    }
  }

  async function publicList() {
    const list = configured() ? await getCatalog() : [];
    return {
      default: 'auto',
      providers: { gemini: hasGemini(), groq: hasGroq() },
      models: list.map(e => ({
        id: e.id, label: e.label, desc: e.desc, group: e.group, provider: e.provider,
        caps: e.caps, tags: e.tags, busy: Math.ceil(coolLeft(e) / 1000)
      }))
    };
  }

  /* Admin: ask every model for a one-word reply, in parallel */
  async function testAll() {
    const list = await getCatalog(true);
    return Promise.all(list.map(async (e) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30000);
      const t0 = clock();
      let text = '';
      try {
        const r = await run({ chain: [e], contents: [{ role: 'user', parts: [{ text: 'Reply with exactly one word: OK' }] }],
          system: 'You are a health check. Reply with one word.', temperature: 0, maxTokens: 512, geminiMaxTokens: 2048, autoContinue: 0, signal: ac.signal,
          onDelta: (t) => { text += t; } });
        const ok = !!r.used;
        if (ok) clearCool(e);
        return { id: e.id, label: e.label, ok, ms: clock() - t0,
          error: ok ? '' : (ac.signal.aborted ? 'timed out' : ((r.lastError && (r.lastError.kind + (r.lastError.status ? ' ' + r.lastError.status : '') + ': ' + String(r.lastError.msg || '').slice(0, 160))) || 'no answer')) };
      } finally { clearTimeout(timer); }
    }));
  }

  return {
    getCatalog, buildChain, run, failureMessage, publicList, testAll,
    configured, hasGemini, hasGroq, coolLeft,
    catalogErrors: () => (cache && cache.errors) || {}
  };
}

module.exports = {
  createAiEngine,
  _internals: { geminiInfo, pickGeminiModels, geminiEntry, groqEntry, prettyGroq, classify, retryMsFrom, thinkStripper, toOpenAiMessages }
};
