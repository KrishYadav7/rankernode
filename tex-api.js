'use strict';
/* ============================================================
   ⭐ LaTeX ENGINE API (2026-10-10) — real TeX Live, like Overleaf
   ------------------------------------------------------------
   POST /api/tex/render   {items: [source, …]}   (logged in)
        → {results: [{hash, ok, pages, sizes, error, line}]}
        Cached results come back at once; new ones are compiled
        (authors freely, students only a few per hour — their
        quizzes were compiled when the author previewed them).
   GET  /api/tex/svg/:hash/:page.svg               (public, immutable)
   GET  /api/tex/status                            (engine present?)

   What gets compiled here: blocks the browser cannot draw — TikZ,
   pgfplots, circuitikz, chemfig, tikz-cd, forest, any package
   (\begin{latex} … \end{latex}) or a whole \documentclass document.
   Ordinary math & text LaTeX is rendered instantly in the browser.

   Safety (the server compiles text written by users):
     • -no-shell-escape + shell_escape=f   → no shell commands
     • openin_any=p / openout_any=p        → no reading or writing
       outside the job folder (no /etc/passwd, no ../)
     • 25 s time limit, the whole process group is killed after
     • 2 compiles at a time, size caps on source and SVG output
     • SVGs are served as images (scripts inside never run) with
       a strict Content-Security-Policy
   ============================================================ */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIMITS = {
  source: 60000,          // characters per block
  items: 24,              // blocks per request
  pages: 12,              // pages kept from a full document
  svgBytes: 2500000,      // per page
  timeoutMs: 25000,
  concurrent: 2,
  queue: 40
};
const VERSION = 'v1';     // bump to recompile everything (e.g. after changing the preamble)

/* ---------- finding TeX Live ---------- */
const SEARCH_DIRS = ['/Library/TeX/texbin', '/usr/local/texlive/2025/bin/x86_64-linux', '/usr/local/texlive/2024/bin/x86_64-linux',
  '/usr/local/texlive/2025/bin/universal-darwin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
let _bins = null;
function findBin(name) {
  const fromEnv = process.env['TEX_' + name.toUpperCase() + '_BIN'];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const dirs = SEARCH_DIRS.concat((process.env.PATH || '').split(path.delimiter));
  for (const d of dirs) { const p = path.join(d, name); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {} }
  return null;
}
function bins() {
  if (_bins && _bins.latex && _bins.dvisvgm) return _bins;
  _bins = { latex: findBin('latex'), dvisvgm: findBin('dvisvgm') };
  return _bins;
}

/* ---------- building the document ---------- */
const HOIST = /^[ \t]*\\(usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tikzset|ctikzset|sisetup|definecolor|colorlet|DeclareMathOperator|newtheorem|setchemfig|tdplotsetmaincoords)\b[^\n]*$/gm;
function autoPackages(src) {
  const has = (re) => re.test(src);
  const p = ['amsmath', 'amssymb', 'amsfonts', 'mathtools', 'bm', 'xcolor', 'graphicx', 'array', 'booktabs', 'multirow', 'cancel'];
  const tikz = has(/\\begin\{(tikzpicture|axis|circuitikz|tikzcd|forest)\}|\\tikz\b|\\draw\b|\\node\b|\\chemfig|\\addplot/);
  if (tikz) p.push('tikz');
  if (has(/\\begin\{(axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis)\}|\\addplot/)) p.push('pgfplots');
  if (has(/\\begin\{polaraxis\}/)) p.push('PGFPLOTSLIB:polar');
  if (has(/\\begin\{circuitikz\}|\\ctikzset/)) p.push('circuitikz');
  if (has(/\\begin\{tikzcd\}/)) p.push('tikz-cd');
  if (has(/\\begin\{forest\}/)) p.push('forest');
  if (has(/\\chemfig|\\schemestart|\\setchemfig/)) p.push('chemfig');
  if (has(/\\ce\{|\\pu\{/)) p.push('mhchem');
  if (has(/\\(SI|si|num|unit|qty|ang|SIrange|numrange|qtyrange)\{/)) p.push('siunitx');
  if (has(/\\(tdplotsetmaincoords)/)) p.push('tikz-3dplot');
  if (has(/\\begin\{(tabularx)\}/)) p.push('tabularx');
  if (has(/\\begin\{(longtable)\}/)) p.push('longtable');
  if (has(/\\(lstinputlisting)|\\begin\{lstlisting\}/)) p.push('listings');
  if (has(/\\begin\{(algorithmic|algorithm)\}/)) { p.push('algorithm'); p.push('algpseudocode'); }
  return p;
}
function buildDocument(src) {
  if (/\\documentclass/.test(src)) {
    /* a whole document: compiled as written (DVI mode; TikZ via the dvisvgm driver) */
    /* tell the DVI its real paper size (A4 / letter / geometry), so pages render as pages */
    const withPaper = src.replace(/(\\documentclass(?:\[[^\]]*\])?\{[^}]*\})/, '$1\\AtBeginDvi{\\special{papersize=\\the\\paperwidth,\\the\\paperheight}}');
    return { tex: '\\def\\pgfsysdriver{pgfsys-dvisvgm.def}\n' + withPaper, offset: 1, full: true };
  }
  /* preamble lines the author wrote inside the block move up (their lines stay, empty,
     so error line numbers still match what the author sees) */
  const hoisted = [];
  const body = src.replace(HOIST, (m) => { hoisted.push(m.trim()); return ''; });
  const wanted = autoPackages(src);
  const named = new Set();
  hoisted.forEach(h => { const m = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/.exec(h); if (m) m[1].split(',').forEach(n => named.add(n.trim())); });
  const pkgs = wanted.filter(x => !x.startsWith('PGFPLOTSLIB:') && !named.has(x));
  const lines = ['\\def\\pgfsysdriver{pgfsys-dvisvgm.def}',
    '\\documentclass[varwidth=17cm,border=6pt,12pt]{standalone}'];
  if (pkgs.includes('circuitikz')) { lines.push('\\usepackage[siunitx]{circuitikz}'); pkgs.splice(pkgs.indexOf('circuitikz'), 1); }
  lines.push('\\usepackage{' + pkgs.join(',') + '}');
  if (pkgs.includes('pgfplots')) lines.push('\\pgfplotsset{compat=1.18}');
  if (wanted.includes('PGFPLOTSLIB:polar')) lines.push('\\usepgfplotslibrary{polar}');
  if (pkgs.includes('tikz')) lines.push('\\usetikzlibrary{arrows.meta,calc,positioning,shapes,decorations.pathmorphing,patterns,angles,quotes}');
  hoisted.forEach(h => lines.push(h));
  lines.push('\\begin{document}');
  return { tex: lines.join('\n') + '\n' + body + '\n\\end{document}\n', offset: lines.length, full: false };
}

/* ---------- running TeX ---------- */
function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', done = false;
    const env = Object.assign({}, process.env, {
      openin_any: 'p', openout_any: 'p', shell_escape: 'f', shell_escape_commands: '',
      max_print_line: '1000', TEXMFOUTPUT: cwd, HOME: cwd
    });
    const p = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (d) => { if (out.length < 400000) out += d.toString('utf8'); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => {
      if (done) return;
      try { process.kill(-p.pid, 'SIGKILL'); } catch (_) { try { p.kill('SIGKILL'); } catch (__) {} }
      done = true; resolve({ code: -1, out: out + '\n! Took too long (over ' + Math.round(timeoutMs / 1000) + ' s) — stopped.', timeout: true });
    }, timeoutMs);
    p.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ code: -2, out: String(e && e.message) }); });
    p.on('close', (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out }); });
  });
}
function firstError(log, offset) {
  const lines = String(log || '').split('\n');
  const i = lines.findIndex(l => l.startsWith('! '));
  if (i < 0) return { error: 'LaTeX could not compile this block.', line: 0 };
  let msg = lines[i].slice(2).trim();
  let line = 0;
  for (let k = i + 1; k < Math.min(lines.length, i + 12); k++) {
    const m = /^l\.(\d+)\s?(.*)$/.exec(lines[k]);
    if (m) { line = Math.max(0, Number(m[1]) - offset); if (m[2]) msg += ' — near “' + m[2].trim().slice(0, 60) + '”'; break; }
  }
  if (/File `[^']+\.(sty|cls)' not found/.test(msg)) msg += ' (this package is not installed on the server)';
  return { error: msg.slice(0, 400), line };
}

async function compile(src) {
  const b = bins();
  if (!b.latex || !b.dvisvgm) return { ok: false, missing: true, error: 'The LaTeX engine (TeX Live) is not installed on the server.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-tex-'));
  const t0 = Date.now();
  try {
    const doc = buildDocument(src);
    fs.writeFileSync(path.join(dir, 'job.tex'), doc.tex);
    const tex = await run(b.latex, ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error-style=0', 'job.tex'], dir, LIMITS.timeoutMs);
    const dvi = path.join(dir, 'job.dvi');
    if (tex.code !== 0 || !fs.existsSync(dvi)) {
      let log = tex.out; try { log = fs.readFileSync(path.join(dir, 'job.log'), 'utf8'); } catch (_) {}
      const e = tex.timeout ? { error: 'Took too long to compile (over 25 s) — simplify the diagram.', line: 0 } : firstError(log, doc.offset);
      return Object.assign({ ok: false, ms: Date.now() - t0 }, e);
    }
    const left = Math.max(5000, LIMITS.timeoutMs - (Date.now() - t0));
    /* the page box: standalone sizes snippets to the drawing + border, whole documents keep their paper size */
    const bbox = '--bbox=papersize';
    const svg = await run(b.dvisvgm, ['--no-fonts', bbox, '--zoom=1.0', '--page=1-' + LIMITS.pages, '--output=p-%p.svg', 'job.dvi'], dir, left);
    const files = fs.readdirSync(dir).filter(f => /^p-\d+\.svg$/.test(f)).sort((a, z) => Number(a.slice(2, -4)) - Number(z.slice(2, -4)));
    if (!files.length) return { ok: false, ms: Date.now() - t0, error: 'Compiled, but nothing was drawn (an empty block?).', line: 0 };
    const pages = [], sizes = [];
    for (const f of files) {
      let s = fs.readFileSync(path.join(dir, f), 'utf8');
      if (s.length > LIMITS.svgBytes) return { ok: false, ms: Date.now() - t0, error: 'The drawing is too large — reduce samples / detail.', line: 0 };
      s = s.replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->/g, '');
      const w = /width=['"]([\d.]+)pt['"]/.exec(s), h = /height=['"]([\d.]+)pt['"]/.exec(s);
      pages.push(s); sizes.push([w ? Number(w[1]) : 0, h ? Number(h[1]) : 0]);
    }
    return { ok: true, pages, sizes, ms: Date.now() - t0 };
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

/* ---------- a small queue: at most LIMITS.concurrent TeX runs at once ---------- */
let running = 0; const waiting = []; const inflight = new Map();
function schedule(fn) {
  return new Promise((resolve, reject) => {
    if (waiting.length >= LIMITS.queue) return reject(Object.assign(new Error('The LaTeX engine is busy — try again in a moment.'), { busy: true }));
    waiting.push({ fn, resolve, reject }); pump();
  });
}
function pump() {
  while (running < LIMITS.concurrent && waiting.length) {
    const job = waiting.shift(); running++;
    job.fn().then(job.resolve, job.reject).finally(() => { running--; pump(); });
  }
}

const hashOf = (src) => crypto.createHash('sha256').update(VERSION + '\n' + src).digest('hex');
const publicResult = (doc) => ({ hash: doc.hash, ok: !!doc.ok, pages: (doc.pages || []).length, sizes: doc.sizes || [], error: doc.error || '', line: doc.line || 0 });

module.exports = function mountTexApi(app, deps) {
  const { requireUser, rateLimit, TexRender } = deps;
  const log = deps.logger || console;
  const role = (u) => String((u && u.role) || '').toLowerCase();
  const isAuthor = (u) => role(u) === 'admin' || role(u) === 'professor';

  /* new compiles per person: authors 400 / 10 min, students 12 / hour
     (cached diagrams never count) */
  const budget = new Map();
  function takeCompile(req) {
    const author = isAuthor(req.authUser);
    const key = String(req.authUserId || req.ip), win = author ? 10 * 60 * 1000 : 60 * 60 * 1000, max = author ? 400 : 12;
    const now = Date.now(), b = budget.get(key);
    if (!b || now - b.start > win) { budget.set(key, { start: now, n: 1 }); return true; }
    if (b.n >= max) return false;
    b.n++; return true;
  }
  setInterval(() => { const now = Date.now(); budget.forEach((b, k) => { if (now - b.start > 3600000) budget.delete(k); }); }, 600000).unref();
  void rateLimit;

  app.get('/api/tex/status', requireUser, (req, res) => {
    const b = bins();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, available: !!(b.latex && b.dvisvgm), running, waiting: waiting.length });
  });

  app.post('/api/tex/render', requireUser, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, LIMITS.items) : [];
      if (!items.length) return res.json({ success: true, results: [] });
      const srcs = items.map(s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim());
      const hashes = srcs.map(hashOf);
      const found = await TexRender.find({ hash: { $in: hashes } }).select('hash ok pages sizes error line').lean();
      const byHash = new Map(found.map(d => [d.hash, d]));
      TexRender.updateMany({ hash: { $in: found.map(d => d.hash) } }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

      const results = [];
      let limited = false;
      for (let i = 0; i < srcs.length; i++) {
        const src = srcs[i], hash = hashes[i];
        if (byHash.has(hash)) { results.push(publicResult(byHash.get(hash))); continue; }
        if (!src) { results.push({ hash, ok: false, pages: 0, error: 'Empty block.' }); continue; }
        if (src.length > LIMITS.source) { results.push({ hash, ok: false, pages: 0, error: 'This block is too long (over 60,000 characters).' }); continue; }
        /* new block: authors compile freely, students sparingly (rate limit) */
        if (!limited && !takeCompile(req)) limited = true;
        if (limited) { results.push({ hash, ok: false, pages: 0, pending: true, error: 'Not drawn yet — please try again later.' }); continue; }
        try {
          let job = inflight.get(hash);
          if (!job) { job = schedule(() => compile(src)); inflight.set(hash, job); job.finally(() => inflight.delete(hash)); }
          const r = await job;
          if (r.missing) { results.push({ hash, ok: false, pages: 0, missing: true, error: r.error }); continue; }
          const doc = { hash, ok: r.ok, pages: r.pages || [], sizes: r.sizes || [], error: r.error || '', line: r.line || 0, ms: r.ms || 0,
            bytes: (r.pages || []).reduce((n, p) => n + p.length, 0), lastUsedAt: new Date() };
          await TexRender.updateOne({ hash }, { $set: doc }, { upsert: true });
          results.push(publicResult(doc));
          log.log(`[tex] compiled ${hash.slice(0, 10)} ${r.ok ? '✓ ' + doc.pages.length + 'p' : '✗ ' + doc.error.slice(0, 80)} in ${r.ms} ms`);
        } catch (e) {
          results.push({ hash, ok: false, pages: 0, pending: true, error: e.busy ? e.message : 'Could not compile right now.' });
        }
      }
      res.json({ success: true, results });
    } catch (e) {
      log.error('[tex] render', e);
      res.status(500).json({ success: false, message: 'The LaTeX engine failed.' });
    }
  });

  app.get('/api/tex/svg/:hash/:page.svg', async (req, res) => {
    try {
      const hash = String(req.params.hash || '');
      const page = Math.max(1, parseInt(req.params.page, 10) || 1);
      if (!/^[0-9a-f]{64}$/.test(hash)) return res.status(404).end();
      const doc = await TexRender.findOne({ hash, ok: true }).select({ pages: { $slice: [page - 1, 1] } }).lean();
      const svg = doc && doc.pages && doc.pages[0];
      if (!svg) return res.status(404).end();
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(svg);
    } catch (e) { res.status(500).end(); }
  });

  return { LIMITS, compile, buildDocument, hashOf };
};
module.exports.buildDocument = buildDocument;
module.exports.compile = compile;
module.exports.hashOf = hashOf;
