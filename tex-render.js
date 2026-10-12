/* ============================================================
   ⭐ RANKERNODE LaTeX RENDERER (2026-10-10) — window.AeroTeX
   ------------------------------------------------------------
   Turns LaTeX written in quiz questions, options and explanations
   into a page, the way Overleaf would show it:

   • math — $…$, \(…\), $$…$$, \[…\], equation / align / gather /
     multline … — is left to MathJax (every MathJax TeX package is
     loaded: ams, mathtools, physics, mhchem, cancel, color, …);
   • text-mode LaTeX — \textbf, \emph, lists, tabular tables, sections,
     figures, theorem boxes, code listings, links, colours, sizes,
     accents, footnotes … — becomes safe HTML right here;
   • everything else — TikZ, pgfplots, circuitikz, tikz-cd, forest,
     chemfig, any \usepackage, \begin{latex}…\end{latex}, or a whole
     \documentclass document — is compiled by real TeX Live on the
     server (tex-api.js) and shown as a crisp SVG.

   Safety: the source is never inserted as HTML. Every character is
   escaped and only the tags built here are emitted; links must be
   http(s)/mailto, images http(s) or /uploads, colours are validated.
   ============================================================ */
(function () {
  'use strict';
  if (window.AeroTeX) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isAuthor = () => { try { const r = String((window.currentUser || (typeof currentUser !== 'undefined' && currentUser) || {}).role || '').toLowerCase(); return r === 'admin' || r === 'professor'; } catch (_) { return false; } };

  let seq = 0;
  /* ========================================================
     1. SCANNING HELPERS
     ======================================================== */
  /* index just after the group that opens at s[i] ('{' or '['), honouring nesting and \{ */
  function groupEnd(s, i) {
    const open = s[i], close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let k = i; k < s.length; k++) {
      const c = s[k];
      if (c === '\\') { k++; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return k + 1; }
    }
    return -1;
  }
  function skipWs(s, i) { while (i < s.length && (s[i] === ' ' || s[i] === '\t' || (s[i] === '\n' && s[i + 1] !== '\n'))) i++; return i; }
  /* reads an optional [..] then n {..} args starting at i → {opt, args, end} */
  function readArgs(s, i, n, wantOpt) {
    let opt = null; const args = [];
    let j = skipWs(s, i);
    if (wantOpt && s[j] === '[') { const e = groupEnd(s, j); if (e > 0) { opt = s.slice(j + 1, e - 1); i = e; j = skipWs(s, i); } }
    for (let a = 0; a < n; a++) {
      j = skipWs(s, i);
      if (s[j] === '{') { const e = groupEnd(s, j); if (e < 0) break; args.push(s.slice(j + 1, e - 1)); i = e; }
      else if (j < s.length && s[j] !== '\\') { args.push(s[j]); i = j + 1; }      // \frac12-style single tokens
      else break;
    }
    return { opt, args, end: i };
  }
  /* position of the \end{name} that closes a \begin{name} whose body starts at i (nesting-aware) */
  function envEnd(s, name, i) {
    const b = '\\begin{' + name + '}', e = '\\end{' + name + '}';
    let depth = 1, k = i;
    while (k < s.length) {
      const nb = s.indexOf(b, k), ne = s.indexOf(e, k);
      if (ne < 0) return -1;
      if (nb >= 0 && nb < ne) { depth++; k = nb + b.length; continue; }
      depth--; if (depth === 0) return ne;
      k = ne + e.length;
    }
    return -1;
  }
  /* split at a top-level separator (outside braces and nested environments) */
  function splitTop(s, sep) {
    const out = []; let depth = 0, envDepth = 0, last = 0;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\\') {
        if (s.startsWith('\\begin{', k)) envDepth++;
        else if (s.startsWith('\\end{', k)) envDepth--;
        else if (sep === '\\\\' && s[k + 1] === '\\' && depth === 0 && envDepth === 0) { out.push(s.slice(last, k)); k++; last = k + 1; continue; }
        k++; continue;
      }
      if (c === '{') depth++; else if (c === '}') depth--;
      else if (sep === '&' && c === '&' && depth === 0 && envDepth === 0) { out.push(s.slice(last, k)); last = k + 1; }
    }
    out.push(s.slice(last));
    return out;
  }

  /* ========================================================
     2. ENGINE BLOCKS — what only real TeX can draw
     ======================================================== */
  const ENGINE_ENVS = ['tikzpicture', 'circuitikz', 'tikzcd', 'forest', 'latex', 'pspicture'];
  const PREAMBLE_LINE = /^[ \t]*\\(usepackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tikzset|ctikzset|sisetup|definecolor|colorlet|setchemfig|tdplotsetmaincoords)\b[^\n]*\n?/;
  function splitEngine(src) {
    const parts = []; let i = 0, textStart = 0;
    const pushText = (end) => { if (end > textStart) parts.push({ t: 'text', s: src.slice(textStart, end) }); };
    /* preamble lines written just above a block belong to it */
    const pullPreamble = (blockStart) => {
      let st = blockStart;
      for (;;) {
        const lineStart = src.lastIndexOf('\n', st - 2) + 1;
        if (lineStart < textStart) break;
        const line = src.slice(lineStart, st);
        if (!PREAMBLE_LINE.test(line)) break;
        st = lineStart;
        if (lineStart === 0) break;
      }
      return st;
    };
    while (i < src.length) {
      const k = src.indexOf('\\', i);
      if (k < 0) break;
      let m;
      if (src.startsWith('\\documentclass', k) && (m = src.indexOf('\\end{document}', k)) > 0) {
        const end = m + '\\end{document}'.length;
        pushText(k); parts.push({ t: 'tex', s: src.slice(k, end), full: true });
        i = textStart = end; continue;
      }
      const env = /^\\begin\{([a-zA-Z*]+)\}/.exec(src.slice(k, k + 40));
      if (env && ENGINE_ENVS.includes(env[1])) {
        const bodyStart = k + env[0].length, e = envEnd(src, env[1], bodyStart);
        if (e > 0) {
          const end = e + ('\\end{' + env[1] + '}').length;
          const st = pullPreamble(k);
          pushText(st);
          let block = src.slice(st, end);
          if (env[1] === 'latex') block = src.slice(st, k) + src.slice(bodyStart, e);   // \begin{latex}…\end{latex}: compile what is inside
          parts.push({ t: 'tex', s: block.trim() });
          i = textStart = end; continue;
        }
      }
      if (src.startsWith('\\chemfig', k) || src.startsWith('\\schemestart', k)) {
        let end = -1;
        if (src.startsWith('\\schemestart', k)) { const z = src.indexOf('\\schemestop', k); if (z > 0) end = z + '\\schemestop'.length; }
        else { const r = readArgs(src, k + '\\chemfig'.length, 1, true); if (r.args.length) end = r.end; }
        if (end > 0) {
          const st = pullPreamble(k);
          pushText(st); parts.push({ t: 'tex', s: src.slice(st, end).trim(), inline: true });
          i = textStart = end; continue;
        }
      }
      i = k + 1;
    }
    pushText(src.length);
    return parts;
  }

  /* ========================================================
     3. TEXT-MODE LaTeX → HTML
     ======================================================== */
  const MATH_ENVS = ['equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray', 'displaymath', 'math', 'split', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'array', 'subequations', 'aligned', 'gathered', 'empheq', 'dmath'];
  const isMathEnv = (n) => MATH_ENVS.includes(n.replace(/\*$/, ''));
  const MATH_ENV_RE = new RegExp('\\\\begin\\{((?:' + MATH_ENVS.join('|') + ')\\*?)\\}[\\s\\S]*?\\\\end\\{\\1\\}', 'g');
  /* $…$, $$…$$, \(…\), \[…\] — scanned by hand (no regex look-behind: older iPhones) */
  function protectMath(s, keep) {
    let out = '', i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && (s[i + 1] === '(' || s[i + 1] === '[')) {
        const close = s[i + 1] === '(' ? '\\)' : '\\]', e = s.indexOf(close, i + 2);
        if (e > 0) { out += keep(esc(s.slice(i, e + 2))); i = e + 2; continue; }
      }
      if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; }          // \$ and other escapes stay text
      if (c === '$') {
        const dbl = s[i + 1] === '$', open = dbl ? 2 : 1;
        let k = i + open, found = -1;
        while (k < s.length) {
          if (s[k] === '\\') { k += 2; continue; }
          if (s[k] === '$' && (!dbl || s[k + 1] === '$')) { found = k; break; }
          if (!dbl && s[k] === '\n' && s[k + 1] === '\n') break;             // a paragraph break ends inline math
          k++;
        }
        if (found >= i + open + 1) { const end = found + open; out += keep(esc(s.slice(i, end))); i = end; continue; }
      }
      out += c; i++;
    }
    return out;
  }
  const SIZES = { tiny: .6, scriptsize: .72, footnotesize: .82, small: .91, normalsize: 1, large: 1.2, Large: 1.44, LARGE: 1.73, huge: 2.07, Huge: 2.49 };
  const DECL = { bfseries: 'font-weight:700', mdseries: 'font-weight:400', itshape: 'font-style:italic', slshape: 'font-style:oblique', upshape: 'font-style:normal',
    ttfamily: 'font-family:var(--tex-mono)', sffamily: 'font-family:var(--font-sans)', rmfamily: 'font-family:var(--tex-serif)', scshape: 'font-variant:small-caps', em: 'font-style:italic',
    bf: 'font-weight:700', it: 'font-style:italic', tt: 'font-family:var(--tex-mono)', centering: '' };
  const WRAP1 = {
    textbf: ['<strong>', '</strong>'], textit: ['<em>', '</em>'], emph: ['<em class="tex-emph">', '</em>'], textsl: ['<em>', '</em>'],
    underline: ['<u>', '</u>'], uline: ['<u>', '</u>'], texttt: ['<code class="tex-tt">', '</code>'], textsc: ['<span class="tex-sc">', '</span>'],
    textsf: ['<span class="tex-sf">', '</span>'], textrm: ['<span class="tex-rm">', '</span>'], textup: ['<span>', '</span>'], textnormal: ['<span>', '</span>'],
    textmd: ['<span style="font-weight:400">', '</span>'], sout: ['<s>', '</s>'], st: ['<s>', '</s>'], textsuperscript: ['<sup>', '</sup>'],
    textsubscript: ['<sub>', '</sub>'], mbox: ['<span class="tex-nowrap">', '</span>'], hbox: ['<span class="tex-nowrap">', '</span>'], makebox: ['<span>', '</span>'],
    fbox: ['<span class="tex-fbox">', '</span>'], framebox: ['<span class="tex-fbox">', '</span>'], boxed: ['<span class="tex-fbox">', '</span>'],
    paragraph: ['<strong class="tex-paragraph">', '</strong> '], subparagraph: ['<strong>', '</strong> '], enquote: ['“', '”'], text: ['<span>', '</span>'],
    hl: ['<mark>', '</mark>'], hlc: ['<mark>', '</mark>'], ul: ['<u>', '</u>'], so: ['<span style="letter-spacing:.15em">', '</span>'], caps: ['<span class="tex-sc">', '</span>']
  };
  const SYMBOLS = {
    LaTeX: '<span class="tex-logo">L<sup>a</sup>T<sub>e</sub>X</span>', TeX: '<span class="tex-logo">T<sub>e</sub>X</span>', LaTeXe: '<span class="tex-logo">L<sup>a</sup>T<sub>e</sub>X 2ε</span>',
    ldots: '…', dots: '…', textellipsis: '…', S: '§', P: '¶', copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™', pounds: '£', textsterling: '£', euro: '€', texteuro: '€',
    textdegree: '°', degree: '°', checkmark: '✓', textbullet: '•', textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
    textless: '&lt;', textgreater: '&gt;', textbackslash: '\\', textbar: '|', textasciitilde: '~', textasciicircum: '^', textunderscore: '_', dag: '†', ddag: '‡', textdagger: '†',
    i: 'ı', j: 'ȷ', ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', textmu: 'µ', textperthousand: '‰', textpm: '±', texttimes: '×', textdiv: '÷',
    quad: '<span class="tex-sp" style="width:1em"></span>', qquad: '<span class="tex-sp" style="width:2em"></span>', enspace: '<span class="tex-sp" style="width:.5em"></span>',
    thinspace: '&thinsp;', ',': '&thinsp;', ':': '&#8197;', ';': '&ensp;', '!': '', ' ': ' ', '/': '', '@': '', '-': '&shy;',
    noindent: '', indent: '<span class="tex-sp" style="width:1.5em"></span>', par: '<span class="tex-parbreak"></span>', newline: '<br>', linebreak: '<br>', break: '<br>',
    smallskip: '<span class="tex-vsp" style="height:.35em"></span>', medskip: '<span class="tex-vsp" style="height:.7em"></span>', bigskip: '<span class="tex-vsp" style="height:1.2em"></span>',
    hfill: '<span class="tex-hfill"></span>', hfil: '<span class="tex-hfill"></span>', vfill: '', centering: '', raggedright: '', raggedleft: '', newpage: '<hr class="tex-pagebreak">',
    clearpage: '<hr class="tex-pagebreak">', pagebreak: '<hr class="tex-pagebreak">', maketitle: '', tableofcontents: '', protect: '', relax: '', selectfont: '', normalfont: '', hline: '', today: ''
  };
  const ACCENT = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', d: '̣', b: '̱', r: '̊', t: '͡' };
  const XCOLORS = ['black', 'white', 'red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'gray', 'grey', 'darkgray', 'lightgray', 'brown', 'lime', 'olive', 'orange', 'pink', 'purple', 'teal', 'violet', 'navy', 'maroon', 'gold', 'silver', 'indigo', 'crimson', 'coral', 'salmon', 'turquoise', 'orchid', 'tan', 'khaki', 'skyblue'];
  /* xcolor name / mix / model → a CSS colour (or '' when not understood) */
  function cssColor(model, spec) {
    spec = String(spec || '').trim();
    if (model) {
      const m = model.toLowerCase();
      if (m === 'html' && /^[0-9a-f]{6}$/i.test(spec)) return '#' + spec;
      const n = spec.split(',').map(Number);
      if (m === 'rgb' && n.length === 3 && n.every(x => x >= 0 && x <= 1)) return `rgb(${n.map(x => Math.round(x * 255)).join(',')})`;
      if (m === 'rgb' && n.length === 3 && n.every(x => x >= 0 && x <= 255)) return `rgb(${n.join(',')})`;
      if (m === 'gray' && n.length === 1 && n[0] >= 0 && n[0] <= 1) { const g = Math.round(n[0] * 255); return `rgb(${g},${g},${g})`; }
      return '';
    }
    /* red!40  /  red!40!blue  /  -red */
    const mix = /^([a-zA-Z]+)(?:!(\d{1,3})(?:!([a-zA-Z]+))?)?$/.exec(spec);
    if (!mix || !XCOLORS.includes(mix[1].toLowerCase())) return '';
    const a = mix[1].toLowerCase(), pct = mix[2] ? Math.min(100, Number(mix[2])) : 100, b = mix[3] && XCOLORS.includes(mix[3].toLowerCase()) ? mix[3].toLowerCase() : 'white';
    return pct >= 100 ? a : `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  }
  function safeUrl(u, img) {
    u = String(u || '').trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (!img && /^mailto:[^\s"'<>]+$/i.test(u)) return u;
    if (img && /^\/uploads\/[^\s"'<>]+$/.test(u)) return u;
    return '';
  }
  function lengthCss(v) {
    v = String(v || '').trim();
    let m = /^([\d.]+)\s*\\(textwidth|linewidth|columnwidth|hsize)$/.exec(v);
    if (m) return Math.min(100, Number(m[1]) * 100) + '%';
    m = /^([\d.]+)\s*(cm|mm|in|pt|em|ex|px)$/.exec(v);
    if (m) return m[1] + m[2];
    if (/^\\(textwidth|linewidth|columnwidth)$/.test(v)) return '100%';
    return '';
  }

  /* ---- protect verbatim & math first: they are copied exactly ---- */
  function protect(src, store) {
    const keep = (html) => { store.push(html); return '\u0001' + (store.length - 1) + '\u0002'; };
    void isMathEnv;
    let s = src;
    /* verbatim-like environments: shown as code, never interpreted */
    s = s.replace(/\\begin\{(verbatim\*?|lstlisting|minted|Verbatim|comment)\}(\[[^\]]*\])?(\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g, (m, env, opt, lang, body) => {
      if (env === 'comment') return '';
      const l = (lang || '').replace(/[{}]/g, '') || ((/language=([A-Za-z+#]+)/.exec(opt || '') || [])[1] || '');
      return keep(`<pre class="tex-code"${l ? ` data-lang="${esc(l)}"` : ''}><code>${esc(body.replace(/^\n/, '').replace(/\n$/, ''))}</code></pre>`);
    });
    s = s.replace(/\\(?:verb|lstinline)\*?([^a-zA-Z\s{])([^\n]*?)\1/g, (m, d, body) => keep(`<code class="tex-tt">${esc(body)}</code>`));
    s = s.replace(/\\lstinline\{([^}]*)\}/g, (m, body) => keep(`<code class="tex-tt">${esc(body)}</code>`));
    /* math: left exactly as written for MathJax — delimited math first, then math environments */
    s = protectMath(s, keep);
    s = s.replace(MATH_ENV_RE, (m) => keep(esc(m)));
    return s;
  }

  function convert(src, figs) {
    const store = [];
    const keep = (html) => { store.push(html); return '\u0001' + (store.length - 1) + '\u0002'; };
    let text = String(src || '').replace(/\r\n?/g, '\n');
    if (figs) {
      text = splitEngine(text).map(part => {
        if (part.t === 'text') return part.s;
        const id = 'tx' + (++seq); figs.push({ id, part });
        return keep(figureHtml(part, id));
      }).join('');
    }
    const s = protect(text, store);
    const ctx = { foot: [] };
    let html = conv(s, ctx);
    if (ctx.foot.length) html += `<ol class="tex-footnotes">${ctx.foot.map(f => `<li>${f}</li>`).join('')}</ol>`;
    return html.replace(/\u0001(\d+)\u0002/g, (m, n) => store[Number(n)]);
  }

  function conv(s, ctx) {
    let out = '', i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\u0001') { const e = s.indexOf('\u0002', i); out += s.slice(i, e + 1); i = e + 1; continue; }
      if (c === '%') { const e = s.indexOf('\n', i); if (e < 0) break; i = e + 1; while (s[i] === ' ' || s[i] === '\t') i++; continue; }
      if (c === '{') { const e = groupEnd(s, i); if (e < 0) { out += '{'; i++; continue; } out += '<span>' + conv(s.slice(i + 1, e - 1), ctx) + '</span>'; i = e; continue; }
      if (c === '}') { i++; continue; }
      if (c === '~') { out += '&nbsp;'; i++; continue; }
      if (c === '\n') {
        let j = i; while (j < s.length && /[\n \t]/.test(s[j])) j++;
        out += (s.slice(i, j).split('\n').length > 2) ? '<span class="tex-parbreak"></span>' : ' ';
        i = j; continue;
      }
      if (c === '-' && s[i + 1] === '-') { if (s[i + 2] === '-') { out += '—'; i += 3; } else { out += '–'; i += 2; } continue; }
      if (c === '`' && s[i + 1] === '`') { out += '“'; i += 2; continue; }
      if (c === "'" && s[i + 1] === "'") { out += '”'; i += 2; continue; }
      if (c === '`') { out += '‘'; i++; continue; }
      if (c === '\\') { const r = command(s, i, ctx); out += r.html; i = r.end; if (r.rest != null) { out += r.rest; break; } continue; }
      let j = i + 1;
      while (j < s.length && !'\u0001%{}~\n-`\'\\'.includes(s[j])) j++;
      out += esc(s.slice(i, j)); i = j;
    }
    return out;
  }

  function command(s, i, ctx) {
    const m = /^\\([a-zA-Z]+\*?|[\s\S])/.exec(s.slice(i, i + 60));
    if (!m) return { html: '\\', end: i + 1 };
    const raw = m[1], name = raw.replace(/\*$/, ''), star = raw.endsWith('*');
    let p = i + m[0].length;
    /* escaped characters */
    if ('%&#_{}$'.includes(raw)) return { html: raw === '$' ? '\\$' : esc(raw), end: p };
    if (raw === '\\') { const r = readArgs(s, p, 0, true); return { html: '<br>', end: s[skipWs(s, p)] === '[' ? r.end : p }; }
    if (raw === '\n' || raw === ' ') return { html: ' ', end: p };
    /* accents  \'e  \"{o}  \c{c} */
    if (ACCENT[name] && (name.length === 1 || /^[uvHckdbrt]$/.test(name))) {
      const r = readArgs(s, p, 1, false);
      if (r.args.length) return { html: esc((r.args[0].replace(/^\\([ij])$/, (x, l) => l === 'i' ? 'ı' : 'ȷ') + ACCENT[name]).normalize('NFC')), end: r.end };
    }
    if (SYMBOLS[name] != null && !WRAP1[name]) {
      if (name === 'today') return { html: esc(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })), end: p };
      /* a control word swallows the space after it */
      if (/^[a-zA-Z]/.test(name) && s[p] === ' ') p++;
      if (/^[a-zA-Z]/.test(name) && s[p] === '{' && s[p + 1] === '}') p += 2;
      return { html: SYMBOLS[name], end: p };
    }
    if (name === 'begin') {
      const em = /^\{([a-zA-Z*]+)\}/.exec(s.slice(p, p + 40));
      if (!em) return { html: '\\begin', end: p };
      const env = em[1], bodyStart = p + em[0].length, e = envEnd(s, env, bodyStart);
      if (e < 0) return { html: esc('\\begin{' + env + '}'), end: bodyStart };
      const end = e + ('\\end{' + env + '}').length;
      return { html: environment(env, s.slice(bodyStart, e), ctx), end };
    }
    if (name === 'end') { const em = /^\{[a-zA-Z*]+\}/.exec(s.slice(p, p + 40)); return { html: '', end: em ? p + em[0].length : p }; }
    if (WRAP1[name]) {
      const r = readArgs(s, p, 1, true);
      if (!r.args.length) return { html: '', end: p };
      return { html: WRAP1[name][0] + conv(r.args[0], ctx) + WRAP1[name][1], end: r.end };
    }
    if (/^(sub){0,2}section$|^chapter$|^part$/.test(name)) {
      const r = readArgs(s, p, 1, true);
      const lvl = { part: 2, chapter: 2, section: 3, subsection: 4, subsubsection: 5 }[name];
      return { html: `<h${lvl} class="tex-h tex-${name}">${conv(r.args[0] || '', ctx)}</h${lvl}>`, end: r.end };
    }
    if (name === 'title' || name === 'author' || name === 'date') { const r = readArgs(s, p, 1, false); return { html: name === 'title' ? `<div class="tex-title">${conv(r.args[0] || '', ctx)}</div>` : '', end: r.end }; }
    if (SIZES[name] != null || DECL[name] != null || name === 'color') {
      /* a declaration: applies to the rest of the current group */
      let style = '';
      if (SIZES[name] != null) style = `font-size:${SIZES[name]}em`;
      else if (name === 'color') {
        const r = readArgs(s, p, 1, true);
        const col = cssColor(r.opt, r.args[0]);
        p = r.end; style = col ? `color:${col}` : '';
      } else style = DECL[name];
      if (s[p] === ' ') p++;
      return { html: style ? `<span style="${esc(style)}">` : '<span>', end: s.length, rest: conv(s.slice(p), ctx) + '</span>' };
    }
    if (name === 'textcolor') { const r = readArgs(s, p, 2, true); const col = cssColor(r.opt, r.args[0]); return { html: `<span${col ? ` style="color:${esc(col)}"` : ''}>${conv(r.args[1] || '', ctx)}</span>`, end: r.end }; }
    if (name === 'colorbox') { const r = readArgs(s, p, 2, true); const col = cssColor(r.opt, r.args[0]); return { html: `<span class="tex-colorbox"${col ? ` style="background:${esc(col)}"` : ''}>${conv(r.args[1] || '', ctx)}</span>`, end: r.end }; }
    if (name === 'fcolorbox') { const r = readArgs(s, p, 3, true); const f = cssColor(r.opt, r.args[0]), b = cssColor(r.opt, r.args[1]); return { html: `<span class="tex-colorbox" style="${f ? 'border:1px solid ' + esc(f) + ';' : ''}${b ? 'background:' + esc(b) : ''}">${conv(r.args[2] || '', ctx)}</span>`, end: r.end }; }
    if (name === 'href') { const r = readArgs(s, p, 2, false); const u = safeUrl(r.args[0]); return { html: u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${conv(r.args[1] || '', ctx)}</a>` : conv(r.args[1] || '', ctx), end: r.end }; }
    if (name === 'url' || name === 'nolinkurl') { const r = readArgs(s, p, 1, false); const u = safeUrl(r.args[0]); return { html: u && name === 'url' ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" class="tex-url">${esc(r.args[0])}</a>` : `<code class="tex-tt">${esc(r.args[0] || '')}</code>`, end: r.end }; }
    if (name === 'includegraphics') {
      const r = readArgs(s, p, 1, true); const u = safeUrl(r.args[0], true);
      let style = '';
      const w = /(?:^|,)\s*width\s*=\s*([^,]+)/.exec(r.opt || ''), sc = /(?:^|,)\s*scale\s*=\s*([\d.]+)/.exec(r.opt || '');
      if (w && lengthCss(w[1])) style = `width:${lengthCss(w[1])}`; else if (sc) style = `width:${Math.min(100, Number(sc[1]) * 60)}%`;
      return { html: u ? `<img class="tex-img" src="${esc(u)}" alt="" loading="lazy"${style ? ` style="${esc(style)}"` : ''}>` : `<span class="tex-missing">[image: ${esc(r.args[0] || '')}]</span>`, end: r.end };
    }
    if (name === 'footnote') { const r = readArgs(s, p, 1, true); ctx.foot.push(conv(r.args[0] || '', ctx)); const n = ctx.foot.length; return { html: `<sup class="tex-fnref">${n}</sup>`, end: r.end }; }
    if (name === 'caption') { const r = readArgs(s, p, 1, true); return { html: `<figcaption class="tex-caption">${conv(r.args[0] || '', ctx)}</figcaption>`, end: r.end }; }
    if (name === 'label' || name === 'index' || name === 'vspace' || name === 'addvspace' || name === 'setlength' || name === 'addtolength' || name === 'pagestyle' || name === 'thispagestyle' || name === 'usepackage' || name === 'documentclass' || name === 'setcounter' || name === 'newgeometry' || name === 'linespread' || name === 'renewcommand' || name === 'newcommand' || name === 'providecommand') {
      const n = name === 'setlength' || name === 'addtolength' || name === 'setcounter' ? 2 : (name === 'renewcommand' || name === 'newcommand' || name === 'providecommand') ? 2 : 1;
      const r = readArgs(s, p, n, true);
      if (name === 'vspace' || name === 'addvspace') { const h = lengthCss(r.args[0]); return { html: `<span class="tex-vsp"${h ? ` style="height:${esc(h)}"` : ''}></span>`, end: r.end }; }
      return { html: '', end: r.end };
    }
    if (name === 'hspace') { const r = readArgs(s, p, 1, false); const w = lengthCss(r.args[0]); return { html: `<span class="tex-sp"${w ? ` style="width:${esc(w)}"` : ''}></span>`, end: r.end }; }
    /* \ref / \eqref to a numbered equation: MathJax resolves these (it numbers the equations) */
    if (name === 'eqref' || name === 'ref') { const r = readArgs(s, p, 1, false); return { html: esc('\\' + name + '{' + (r.args[0] || '') + '}'), end: r.end }; }
    if (name === 'pageref' || name === 'autoref' || name === 'cref' || name === 'Cref') { const r = readArgs(s, p, 1, false); return { html: `<span class="tex-ref">${esc(r.args[0] || '?')}</span>`, end: r.end }; }
    if (name === 'cite' || name === 'citep' || name === 'citet') { const r = readArgs(s, p, 1, true); return { html: `<span class="tex-ref">[${esc(r.args[0] || '?')}]</span>`, end: r.end }; }
    if (name === 'item') { const r = readArgs(s, p, 0, true); return { html: '<br>• ' + (r.opt ? `<strong>${conv(r.opt, ctx)}</strong> ` : ''), end: r.end }; }
    if (name === 'multicolumn' || name === 'multirow') { const r = readArgs(s, p, 3, false); return { html: conv(r.args[2] || '', ctx), end: r.end }; }
    if (name === 'toprule' || name === 'midrule' || name === 'bottomrule' || name === 'cline' || name === 'cmidrule') { const r = readArgs(s, p, name === 'cline' || name === 'cmidrule' ? 1 : 0, true); return { html: '', end: r.end }; }
    if (name === 'SI' || name === 'qty') { const r = readArgs(s, p, 2, true); return { html: `${esc(r.args[0] || '')}&thinsp;${unitHtml(r.args[1] || '')}`, end: r.end }; }
    if (name === 'si' || name === 'unit') { const r = readArgs(s, p, 1, true); return { html: unitHtml(r.args[0] || ''), end: r.end }; }
    if (name === 'num') { const r = readArgs(s, p, 1, true); return { html: esc(r.args[0] || ''), end: r.end }; }
    if (name === 'ce' || name === 'pu') {
      /* chemistry: hand it to MathJax's mhchem */
      const r = readArgs(s, p, 1, false);
      return { html: esc('\\(\\' + name + '{' + (r.args[0] || '') + '}\\)'), end: r.end };
    }
    /* unknown command: shown as written, so nothing is silently lost */
    return { html: esc('\\' + raw), end: p };
  }
  const UNITS = { metre: 'm', meter: 'm', second: 's', kilogram: 'kg', gram: 'g', newton: 'N', joule: 'J', watt: 'W', pascal: 'Pa', kelvin: 'K', ampere: 'A', volt: 'V', ohm: 'Ω', hertz: 'Hz', mole: 'mol', candela: 'cd',
    coulomb: 'C', farad: 'F', henry: 'H', tesla: 'T', weber: 'Wb', siemens: 'S', litre: 'L', liter: 'L', degreeCelsius: '°C', celsius: '°C', degree: '°', radian: 'rad', minute: 'min', hour: 'h', bar: 'bar', electronvolt: 'eV', percent: '%',
    kilo: 'k', mega: 'M', giga: 'G', milli: 'm', micro: 'µ', nano: 'n', centi: 'c', pico: 'p', tera: 'T', deci: 'd' };
  const PREFIX = { kilo: 'k', mega: 'M', giga: 'G', tera: 'T', milli: 'm', micro: 'µ', nano: 'n', pico: 'p', centi: 'c', deci: 'd' };
  /* \metre\per\second\squared → m/s² · \kilo\gram → kg · plain "km/h" stays as written */
  function unitHtml(u) {
    let out = '', joiner = '', prefix = '';
    (u.match(/\\[a-zA-Z]+|[^\\\s]+/g) || []).forEach(t => {
      const n = t.startsWith('\\') ? t.slice(1) : null;
      if (n === 'per') { joiner = '/'; return; }
      if (n === 'squared' || n === 'square') { out += '²'; return; }
      if (n === 'cubed' || n === 'cubic') { out += '³'; return; }
      if (n && PREFIX[n]) { prefix += PREFIX[n]; return; }
      const sym = n ? (UNITS[n] != null ? UNITS[n] : n) : t;
      out += (out ? (joiner || '·') : '') + prefix + esc(sym).replace(/\^\{?(-?\d+)\}?/, '<sup>$1</sup>');
      joiner = ''; prefix = '';
    });
    return `<span class="tex-unit">${out}</span>`;
  }

  /* ---- environments ---- */
  const THM = { theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary', definition: 'Definition', example: 'Example', remark: 'Remark', note: 'Note',
    exercise: 'Exercise', solution: 'Solution', problem: 'Problem', claim: 'Claim', conjecture: 'Conjecture', hint: 'Hint', answer: 'Answer', question: 'Question' };
  function environment(env, body, ctx) {
    const name = env.replace(/\*$/, '');
    if (name === 'itemize' || name === 'enumerate' || name === 'description' || name === 'compactitem' || name === 'compactenum') {
      const r = readArgs(body, 0, 0, true);
      const opt = r.opt || '';
      const content = body.slice(r.opt != null ? r.end : 0);
      const items = splitItems(content);
      const ordered = name === 'enumerate' || name === 'compactenum';
      let type = '';
      if (/\\alph\*/.test(opt)) type = 'a'; else if (/\\Alph\*/.test(opt)) type = 'A'; else if (/\\roman\*/.test(opt)) type = 'i'; else if (/\\Roman\*/.test(opt)) type = 'I';
      else if (/^\s*\(?a/.test(opt)) type = 'a'; else if (/^\s*\(?i/.test(opt)) type = 'i';
      if (name === 'description') return `<dl class="tex-dl">${items.map(it => `<dt>${conv(it.label || '', ctx)}</dt><dd>${conv(it.body, ctx)}</dd>`).join('')}</dl>`;
      const tag = ordered ? 'ol' : 'ul';
      return `<${tag} class="tex-list"${type ? ` type="${type}"` : ''}>${items.map(it => `<li${it.label != null ? ` class="tex-li-label" data-label="${esc(it.label)}"` : ''}>${it.label != null ? `<span class="tex-li-mark">${conv(it.label, ctx)}</span>` : ''}${conv(it.body, ctx)}</li>`).join('')}</${tag}>`;
    }
    if (/^(tabular|tabularx|tabulary|tabular\*|longtable|supertabular|tblr)$/.test(env) || name === 'tabular') return table(env, body, ctx);
    if (name === 'center' || name === 'flushleft' || name === 'flushright') return `<div class="tex-${name}">${conv(body, ctx)}</div>`;
    if (name === 'quote' || name === 'quotation' || name === 'verse') return `<blockquote class="tex-quote">${conv(body, ctx)}</blockquote>`;
    if (name === 'abstract') return `<div class="tex-abstract"><div class="tex-abstract-h">Abstract</div>${conv(body, ctx)}</div>`;
    if (name === 'figure' || name === 'table' || name === 'wrapfigure' || name === 'subfigure' || name === 'sidewaysfigure') {
      const r = readArgs(body, 0, name === 'wrapfigure' || name === 'subfigure' ? 1 : 0, true);
      return `<figure class="tex-float">${conv(body.slice(r.opt != null || r.args.length ? r.end : 0), ctx)}</figure>`;
    }
    if (name === 'minipage' || name === 'parbox') {
      const r = readArgs(body, 0, 1, true); const w = lengthCss(r.args[0]);
      return `<div class="tex-minipage"${w ? ` style="width:${esc(w)}"` : ''}>${conv(body.slice(r.end), ctx)}</div>`;
    }
    if (name === 'multicols') { const r = readArgs(body, 0, 1, false); const n = Math.min(4, Math.max(1, parseInt(r.args[0], 10) || 2)); return `<div class="tex-multicols" style="column-count:${n}">${conv(body.slice(r.end), ctx)}</div>`; }
    if (name === 'proof') {
      const r = readArgs(body, 0, 0, true);
      return `<div class="tex-proof"><em>${r.opt ? conv(r.opt, ctx) : 'Proof'}.</em> ${conv(body.slice(r.opt != null ? r.end : 0), ctx)}<span class="tex-qed">∎</span></div>`;
    }
    if (THM[name] || /^(thm|lem|prop|cor|defn|dfn|ex|rem)$/.test(name)) {
      const label = THM[name] || { thm: 'Theorem', lem: 'Lemma', prop: 'Proposition', cor: 'Corollary', defn: 'Definition', dfn: 'Definition', ex: 'Example', rem: 'Remark' }[name];
      const r = readArgs(body, 0, 0, true);
      return `<div class="tex-thm tex-thm-${esc(name)}"><strong>${label}${r.opt ? ` (${conv(r.opt, ctx)})` : ''}.</strong> ${conv(body.slice(r.opt != null ? r.end : 0), ctx)}</div>`;
    }
    if (name === 'document') return conv(body, ctx);
    if (name === 'small' || name === 'footnotesize' || name === 'large' || name === 'Large' || name === 'tiny' || name === 'huge') return `<div style="font-size:${SIZES[name]}em">${conv(body, ctx)}</div>`;
    if (name === 'tcolorbox' || name === 'mdframed' || name === 'framed' || name === 'shaded' || name === 'boxedminipage') {
      const r = readArgs(body, 0, 0, true);
      const t = /title\s*=\s*\{?([^},]+)\}?/.exec(r.opt || '');
      return `<div class="tex-box">${t ? `<div class="tex-box-title">${conv(t[1], ctx)}</div>` : ''}${conv(body.slice(r.opt != null ? r.end : 0), ctx)}</div>`;
    }
    /* anything else: its contents */
    return conv(body, ctx);
  }
  function splitItems(content) {
    const items = []; let depth = 0, envDepth = 0, cur = null, k = 0, start = 0;
    const flush = (end) => { if (cur) { cur.body = content.slice(start, end); items.push(cur); } };
    while (k < content.length) {
      const c = content[k];
      if (c === '\\') {
        if (content.startsWith('\\begin{', k)) envDepth++;
        else if (content.startsWith('\\end{', k)) envDepth--;
        else if (depth === 0 && envDepth === 0 && /^\\item(?![a-zA-Z])/.test(content.slice(k, k + 6))) {
          flush(k);
          let p = k + 5; let label = null;
          const j = skipWs(content, p);
          if (content[j] === '[') { const e = groupEnd(content, j); if (e > 0) { label = content.slice(j + 1, e - 1); p = e; } }
          cur = { label }; start = p; k = p; continue;
        }
        k += 2; continue;
      }
      if (c === '{') depth++; else if (c === '}') depth--;
      k++;
    }
    flush(content.length);
    return items;
  }
  function table(env, body, ctx) {
    let pos = 0;
    if (env === 'tabularx' || env === 'tabular*' || env === 'tabulary') { const r = readArgs(body, 0, 1, false); pos = r.end; }
    const spec = readArgs(body, pos, 1, true);
    const colspec = (spec.args[0] || '').replace(/\*\{(\d+)\}\{([^}]*)\}/g, (m, n, x) => x.repeat(Math.min(30, Number(n))));
    const cols = []; let leftBorder = false;
    for (let k = 0; k < colspec.length; k++) {
      const ch = colspec[k];
      if (ch === '|') { if (cols.length) cols[cols.length - 1].rb = true; else leftBorder = true; continue; }
      if (ch === '@' || ch === '>' || ch === '<' || ch === '!') { const e = colspec[k + 1] === '{' ? groupEnd(colspec, k + 1) : -1; if (e > 0) k = e - 1; continue; }
      if ('pmbw'.includes(ch) && colspec[k + 1] === '{') { const e = groupEnd(colspec, k + 1); cols.push({ a: 'left', w: lengthCss(colspec.slice(k + 2, e - 1)) }); k = e - 1; continue; }
      if (ch === 'l' || ch === 'L') cols.push({ a: 'left' }); else if (ch === 'c' || ch === 'C') cols.push({ a: 'center' }); else if (ch === 'r' || ch === 'R' || ch === 'S') cols.push({ a: 'right' }); else if (ch === 'X') cols.push({ a: 'left', grow: true });
    }
    const content = body.slice(spec.end);
    const rows = splitTop(content, '\\\\');
    const rowspanLeft = [];
    let html = `<div class="tex-table-wrap"><table class="tex-table${leftBorder ? ' tex-lb' : ''}"><tbody>`;
    let pendingRule = '';
    rows.forEach((rowRaw, ri) => {
      let row = rowRaw;
      /* rules written before the row's cells */
      let rule = pendingRule; pendingRule = '';
      for (;;) {
        const t = row.replace(/^\s+/, '');
        const m = /^\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(?:\([^)]*\))?\{[^}]*\}|hhline\{[^}]*\})/.exec(t);
        if (!m) { row = t; break; }
        rule = /toprule|bottomrule/.test(m[1]) ? 'thick' : 'thin';
        row = t.slice(m[0].length);
      }
      const cells = splitTop(row, '&');
      if (!row.trim() && cells.length === 1) { if (rule && ri > 0) html = html.replace(/<tr(?: class="[^"]*")?>(?![\s\S]*<tr)/, (x) => x.replace('<tr', `<tr data-rb="${rule}"`)); return; }
      html += `<tr${rule ? ` class="tex-rule-${rule}"` : ''}>`;
      let col = 0;
      cells.forEach((cellRaw) => {
        while (rowspanLeft[col] > 0) { rowspanLeft[col]--; col++; if (!cellRaw.trim()) return; }
        let cell = cellRaw.trim(), span = 1, rspan = 1, align = (cols[col] || {}).a || 'left';
        const mc = /^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{([\s\S]*)\}$/.exec(cell);
        if (mc) { span = Math.min(30, Number(mc[1])); cell = mc[3]; align = /c/.test(mc[2]) ? 'center' : /r/.test(mc[2]) ? 'right' : 'left'; }
        const mr = /^\\multirow\s*\{(\d+)\}\s*\{[^}]*\}\s*\{([\s\S]*)\}$/.exec(cell);
        if (mr) { rspan = Math.min(30, Number(mr[1])); cell = mr[2]; for (let k = 0; k < span; k++) rowspanLeft[col + k] = rspan - 1; }
        const c = cols[col] || {};
        const style = [`text-align:${align}`]; if (c.w) style.push(`width:${c.w}`);
        const cls = []; if (c.rb || (span > 1 && (cols[col + span - 1] || {}).rb)) cls.push('tex-rb');
        html += `<td${span > 1 ? ` colspan="${span}"` : ''}${rspan > 1 ? ` rowspan="${rspan}"` : ''}${cls.length ? ` class="${cls.join(' ')}"` : ''} style="${esc(style.join(';'))}">${conv(cell, { foot: ctx.foot })}</td>`;
        col += span;
      });
      html += '</tr>';
    });
    html = html.replace(/<tr data-rb="(thick|thin)"( class="[^"]*")?>/g, (m, r, cls) => `<tr class="${cls ? cls.slice(8, -1) + ' ' : ''}tex-rule-bottom-${r}">`);
    return html + '</tbody></table></div>';
  }

  /* ========================================================
     4. ENGINE RESULTS (batched, cached for the session)
     ======================================================== */
  const results = new Map();        // source → Promise<result>
  let batch = [], batchTimer = 0;
  function requestRender(src) {
    if (results.has(src)) return results.get(src);
    const p = new Promise((resolve) => { batch.push({ src, resolve }); });
    results.set(src, p);
    clearTimeout(batchTimer); batchTimer = setTimeout(flush, 60);
    return p;
  }
  async function flush() {
    const jobs = batch.splice(0, 24);
    if (batch.length) batchTimer = setTimeout(flush, 0);
    if (!jobs.length) return;
    try {
      const r = await fetch('/api/tex/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: jobs.map(j => j.src) }) });
      const d = await r.json().catch(() => null);
      const list = (d && d.results) || [];
      jobs.forEach((j, i) => {
        const res = list[i] || { ok: false, error: (d && d.message) || 'The LaTeX engine is not reachable.' };
        if (!res.ok && (res.pending || !d)) results.delete(j.src);        // allow a retry later
        j.resolve(res);
      });
    } catch (e) {
      jobs.forEach(j => { results.delete(j.src); j.resolve({ ok: false, pending: true, error: 'Offline — the diagram will appear when you are back online.' }); });
    }
  }
  function figureHtml(part, id) {
    return `<span class="tex-fig${part.inline ? ' tex-fig-inline' : ''}${part.full ? ' tex-fig-doc' : ''}" data-tex-id="${id}" data-state="loading"><span class="tex-fig-loading"><span class="tex-spin"></span> Drawing with LaTeX…</span></span>`;
  }
  function fillFigure(fig, part, res) {
    if (!fig || !fig.isConnected) return;
    if (res.ok) {
      fig.dataset.state = 'ok';
      fig.innerHTML = Array.from({ length: res.pages }, (_, k) => {
        const sz = (res.sizes || [])[k] || [0, 0];
        const w = sz[0] ? Math.round(sz[0] * (part.full ? 1.0 : 1.5)) : 0;          // pt → px (diagrams drawn a little larger, like on screen in Overleaf)
        return `<img class="tex-fig-img${part.full ? ' tex-fig-page' : ''}" src="/api/tex/svg/${res.hash}/${k + 1}.svg" alt="LaTeX ${part.full ? 'page ' + (k + 1) : 'diagram'}" loading="lazy" decoding="async"${w ? ` width="${w}"` : ''}>`;
      }).join('');
      return;
    }
    fig.dataset.state = 'error';
    if (isAuthor()) {
      fig.innerHTML = `<span class="tex-fig-err"><strong><i class="fas fa-triangle-exclamation"></i> ${res.missing ? 'LaTeX engine not installed on the server' : 'LaTeX error' + (res.line ? ' on line ' + res.line : '')}</strong>`
        + `<span>${esc(res.missing ? 'Install TeX Live on the server (see the setup notes) — until then this block cannot be drawn.' : (res.error || 'Could not compile.'))}</span>`
        + `<details><summary>Show source</summary><pre class="tex-code"><code>${esc(part.s).split('\n').map((l, n) => res.line === n + 1 ? `<mark>${l}</mark>` : l).join('\n')}</code></pre></details></span>`;
    } else {
      fig.innerHTML = `<span class="tex-fig-err tex-fig-err-soft"><i class="fas fa-image"></i> ${res.pending ? 'This diagram is still being prepared — reopen in a moment.' : 'This diagram could not be shown.'}</span>`;
    }
  }

  /* ========================================================
     5. RENDERING AN ELEMENT
     ======================================================== */
  function renderInto(el, src) {
    const figs = [];
    el.innerHTML = convert(src, figs);
    el.classList.add('tex-rendered');
    el.__texOut = el.textContent;
    figs.forEach(({ id, part }) => {
      requestRender(part.s).then(res => fillFigure(el.querySelector(`[data-tex-id="${id}"]`), part, res));
    });
    return figs.length;
  }
  /* leaf elements holding raw LaTeX as plain text */
  function prepare(el) {
    if (!el || el.nodeType !== 1 || el.closest('.no-mathjax, .tex-code')) return;
    const pureText = !el.firstElementChild;
    if (pureText) {
      const src = el.textContent;
      if (el.classList.contains('tex-rendered') && el.__texOut === src) return;   // our own output, already done
      if (!/[\\{}%~`$&]|--|''/.test(src)) return;                                 // plain text — nothing to do
      renderInto(el, src);
      return;
    }
    if (el.classList.contains('tex-rendered')) return;
    /* mixed content (e.g. "A." label + text): render each plain-text leaf */
    el.querySelectorAll('span, div, td, p, li').forEach(child => {
      if (!child.firstElementChild && !child.classList.contains('quiz-play-letter') && /[\\{}%~`$]/.test(child.textContent)) prepare(child);
    });
  }

  /* ========================================================
     6. AUTHORING — toolbar on quiz fields, split editor, guide
     ======================================================== */
  const SNIPPETS = {
    math: [
      ['Fraction', '\\frac{a}{b}', 'fa-divide'], ['Square root', '\\sqrt{x}', 'fa-square-root-variable'], ['Power / index', 'x^{2}_{i}', 'fa-superscript'],
      ['Sum', '\\sum_{i=1}^{n} a_i', 'fa-sigma'], ['Integral', '\\int_{a}^{b} f(x)\\,dx', 'fa-wave-square'], ['Limit', '\\lim_{x \\to 0} \\frac{\\sin x}{x}', 'fa-arrow-right-long'],
      ['Derivative', '\\frac{\\mathrm{d}y}{\\mathrm{d}x}', 'fa-chart-line'], ['Partial', '\\frac{\\partial f}{\\partial x}', 'fa-chart-area'], ['Vector', '\\vec{F} = m\\vec{a}', 'fa-arrow-right'],
      ['Matrix', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', 'fa-table-cells'], ['Cases', 'f(x) = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}', 'fa-code-branch'],
      ['Units (SI)', '\\SI{9.81}{\\metre\\per\\second\\squared}', 'fa-ruler'], ['Chemistry', '\\ce{2H2 + O2 -> 2H2O}', 'fa-flask']
    ],
    block: [
      ['Numbered equation', '\\begin{equation}\n  E = mc^2 \\label{eq:energy}\n\\end{equation}', 'fa-hashtag'],
      ['Aligned equations', '\\begin{align}\n  p + \\tfrac12\\rho v^2 &= p_0 \\\\\n  v &= \\sqrt{\\frac{2(p_0 - p)}{\\rho}}\n\\end{align}', 'fa-align-left']
    ],
    text: [
      ['Bullet list', '\\begin{itemize}\n  \\item First point\n  \\item Second point\n\\end{itemize}', 'fa-list-ul'],
      ['Numbered list', '\\begin{enumerate}[(a)]\n  \\item First\n  \\item Second\n\\end{enumerate}', 'fa-list-ol'],
      ['Table', '\\begin{tabular}{|l|c|r|}\n  \\hline\n  Quantity & Symbol & Value \\\\\n  \\hline\n  Lift & $L$ & 1200 N \\\\\n  Drag & $D$ & 85 N \\\\\n  \\hline\n\\end{tabular}', 'fa-table'],
      ['Section heading', '\\section*{Heading}', 'fa-heading'], ['Code', '\\begin{lstlisting}[language=Python]\nprint("Hello")\n\\end{lstlisting}', 'fa-code'],
      ['Definition box', '\\begin{definition}[Reynolds number]\n  $Re = \\frac{\\rho v L}{\\mu}$\n\\end{definition}', 'fa-book'],
      ['Colour', '\\textcolor{red}{important}', 'fa-palette'], ['Link', '\\href{https://example.com}{text}', 'fa-link']
    ],
    diagram: [
      ['TikZ drawing', '\\begin{tikzpicture}[>=Stealth]\n  \\draw[->] (0,0) -- (3,0) node[right] {$x$};\n  \\draw[->] (0,0) -- (0,2) node[above] {$y$};\n  \\draw[thick,blue] (0,0) -- (2.5,1.5) node[midway,above left] {$\\vec{v}$};\n\\end{tikzpicture}', 'fa-pen-ruler'],
      ['Graph (pgfplots)', '\\begin{tikzpicture}\n\\begin{axis}[width=8cm, height=5cm, grid=major, xlabel={$x$}, ylabel={$f(x)$}]\n  \\addplot[blue, thick, domain=-2:2, samples=80] {x^3 - x};\n\\end{axis}\n\\end{tikzpicture}', 'fa-chart-line'],
      ['Circuit', '\\begin{circuitikz}\n  \\draw (0,0) to[V, v=$V_s$] (0,2) to[R=$R$] (3,2) to[C=$C$] (3,0) -- (0,0);\n\\end{circuitikz}', 'fa-bolt'],
      ['Molecule (chemfig)', '\\chemfig{*6((-OH)=-=-=-)}', 'fa-atom'],
      ['Commutative diagram', '\\begin{tikzcd}\n  A \\arrow[r, "f"] \\arrow[d, "g"\'] & B \\arrow[d] \\\\\n  C \\arrow[r] & D\n\\end{tikzcd}', 'fa-diagram-project'],
      ['Any package (real LaTeX)', '\\begin{latex}\n\\usepackage{siunitx}\n\\begin{tabular}{lS}\n  Mass & 1.25 \\\\\n  Speed & 340.29\n\\end{tabular}\n\\end{latex}', 'fa-cube'],
      ['Full document', '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\section{Title}\nText with $x^2$.\n\\end{document}', 'fa-file-lines']
    ]
  };
  const mathWrap = (snip) => (/^\\begin\{(equation|align|gather|multline)/.test(snip) ? snip : '$' + snip + '$');
  let bar = null, barField = null, menu = null;

  function insert(field, text, opts) {
    opts = opts || {};
    field.focus();
    const a = field.selectionStart, b = field.selectionEnd, sel = field.value.slice(a, b);
    let ins = text;
    if (opts.wrap) ins = opts.wrap[0] + (sel || opts.wrap[2] || '') + opts.wrap[1];
    const block = /\n/.test(ins) && field.tagName === 'TEXTAREA';
    if (block && a > 0 && field.value[a - 1] !== '\n') ins = '\n' + ins;
    if (block && field.value[b] && field.value[b] !== '\n') ins += '\n';
    field.setRangeText(ins, a, b, 'end');
    if (opts.wrap && !sel) { const pos = a + opts.wrap[0].length; field.setSelectionRange(pos, pos + (opts.wrap[2] || '').length); }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'tex-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'LaTeX tools');
    bar.innerHTML = `
      <button type="button" data-w="\\textbf{|}|text" title="Bold (\\textbf)"><i class="fas fa-bold"></i></button>
      <button type="button" data-w="\\emph{|}|text" title="Italic (\\emph)"><i class="fas fa-italic"></i></button>
      <button type="button" data-w="$|$|x^2" title="Inline math $…$"><b>$x$</b></button>
      <button type="button" data-w="\\[ | \\]|E = mc^2" title="Display math \\[…\\]"><b>∑</b></button>
      <span class="tex-bar-sep"></span>
      <button type="button" data-menu="math" title="Math"><i class="fas fa-square-root-variable"></i> Math <i class="fas fa-caret-down"></i></button>
      <button type="button" data-menu="text" title="Text & layout"><i class="fas fa-paragraph"></i> Text <i class="fas fa-caret-down"></i></button>
      <button type="button" data-menu="diagram" title="Diagrams — compiled by real LaTeX"><i class="fas fa-pen-ruler"></i> Diagrams <i class="fas fa-caret-down"></i></button>
      <span class="tex-bar-sep"></span>
      <button type="button" data-act="editor" title="Full LaTeX editor (split view)"><i class="fas fa-up-right-and-down-left-from-center"></i></button>
      <button type="button" data-act="help" title="LaTeX guide"><i class="fas fa-circle-question"></i></button>`;
    bar.addEventListener('mousedown', (e) => e.preventDefault());             // keep the caret in the field
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !barField) return;
      if (b.dataset.w) { const [pre, post, ph] = b.dataset.w.split('|'); insert(barField, '', { wrap: [pre, post, ph] }); return; }
      if (b.dataset.menu) { openMenu(b, b.dataset.menu); return; }
      if (b.dataset.act === 'editor') openEditor(barField);
      if (b.dataset.act === 'help') openGuide(barField);
    });
    document.body.appendChild(bar);
    return bar;
  }
  function placeBar() {
    if (!bar || !barField || !barField.isConnected) return hideBar();
    const r = barField.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { bar.style.visibility = 'hidden'; return; }
    bar.style.visibility = '';
    const top = r.top - bar.offsetHeight - 6;
    bar.style.top = Math.max(6, top < 6 ? r.bottom + 6 : top) + 'px';
    bar.style.left = Math.max(8, Math.min(r.left, innerWidth - bar.offsetWidth - 8)) + 'px';
  }
  function hideBar() { if (bar) bar.classList.remove('show'); closeMenu(); barField = null; }
  function openMenu(anchor, kind) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'tex-menu';
    const list = kind === 'math' ? SNIPPETS.math.map(x => [x[0], mathWrap(x[1]), x[2]]).concat(SNIPPETS.block) : SNIPPETS[kind];
    menu.innerHTML = (kind === 'diagram' ? '<div class="tex-menu-note"><i class="fas fa-microchip"></i> Drawn by real LaTeX (TeX Live) on the server</div>' : '')
      + list.map((x, i) => `<button type="button" data-i="${i}"><i class="fas ${x[2]}"></i><span>${esc(x[0])}</span></button>`).join('');
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b || !barField) return; insert(barField, list[+b.dataset.i][1]); closeMenu(); });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  if (typeof document !== 'undefined') {   /* browser only (the converter also runs in Node tests) */
  document.addEventListener('focusin', (e) => {
    const f = e.target;
    if (f && f.classList && f.classList.contains('latex-source') && isAuthor()) {
      barField = f; ensureBar().classList.add('show'); placeBar();
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target === barField) setTimeout(() => { if (document.activeElement !== barField && !(menu && menu.contains(document.activeElement))) hideBar(); }, 150);
  });
  window.addEventListener('scroll', () => { if (barField) placeBar(); closeMenu(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { if (barField) placeBar(); });
  }

  /* ---- split editor (code ⟷ live preview), like Overleaf ---- */
  function openEditor(field) {
    if (!field) return;
    const ov = document.createElement('div');
    ov.className = 'modal-overlay active tex-editor-ov';
    ov.innerHTML = `
      <div class="tex-editor" role="dialog" aria-modal="true" aria-label="LaTeX editor">
        <div class="tex-editor-head">
          <div class="tex-editor-title"><i class="fas fa-file-code"></i> LaTeX editor <span class="tex-editor-status" id="texEdStatus"></span></div>
          <div class="tex-editor-actions">
            <button type="button" class="btn btn-outline btn-sm" data-ed="help"><i class="fas fa-circle-question"></i> Guide</button>
            <button type="button" class="btn btn-outline btn-sm" data-ed="cancel">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" data-ed="done"><i class="fas fa-check"></i> Done</button>
          </div>
        </div>
        <div class="tex-editor-body">
          <div class="tex-editor-code"><pre class="tex-editor-gutter" aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="LaTeX source"></textarea></div>
          <div class="tex-editor-preview latex-content-preview"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const ta = ov.querySelector('textarea'), gutter = ov.querySelector('.tex-editor-gutter'), pv = ov.querySelector('.tex-editor-preview'), status = ov.querySelector('#texEdStatus');
    ta.value = field.value;
    const lines = () => { const n = ta.value.split('\n').length; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); gutter.scrollTop = ta.scrollTop; };
    let t = 0;
    const preview = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const figs = [];
        pv.innerHTML = convert(ta.value, figs);
        pv.classList.add('tex-rendered');
        if (window.MathJax && window.MathJax.typesetPromise) { try { window.MathJax.typesetClear([pv]); window.MathJax.texReset(); } catch (_) {} window.MathJax.typesetPromise([pv]).catch(() => {}); }
        else if (typeof window.renderMathIn === 'function') window.renderMathIn(pv);
        if (!figs.length) { status.textContent = ''; status.className = 'tex-editor-status'; return; }
        status.innerHTML = '<span class="tex-spin"></span> Compiling with LaTeX…'; status.className = 'tex-editor-status';
        const t0 = performance.now();
        Promise.all(figs.map(({ id, part }) => requestRender(part.s).then(res => { fillFigure(pv.querySelector(`[data-tex-id="${id}"]`), part, res); return res; }))).then(all => {
          const bad = all.find(r => !r.ok);
          if (bad) { status.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${bad.line ? 'Error on line ' + bad.line + ' of the block' : 'Error'}`; status.className = 'tex-editor-status is-bad'; }
          else { status.innerHTML = `<i class="fas fa-circle-check"></i> Compiled (${figs.length} block${figs.length > 1 ? 's' : ''}, ${((performance.now() - t0) / 1000).toFixed(1)} s)`; status.className = 'tex-editor-status is-ok'; }
        });
      }, 450);
    };
    ta.addEventListener('input', () => { lines(); preview(); });
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); insert(ta, '', { wrap: ['\\textbf{', '}', 'text'] }); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); insert(ta, '', { wrap: ['\\emph{', '}', 'text'] }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    const done = (save) => {
      if (save && ta.value !== field.value) { field.value = ta.value; field.dispatchEvent(new Event('input', { bubbles: true })); }
      ov.remove(); try { field.focus(); } catch (_) {}
    };
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ed]');
      if (b && b.dataset.ed === 'done') done(true);
      else if (b && b.dataset.ed === 'cancel') done(false);
      else if (b && b.dataset.ed === 'help') openGuide(ta);
    });
    lines(); preview(); setTimeout(() => ta.focus(), 30);
  }

  /* ---- the guide: what works, with examples to insert ---- */
  function openGuide(field) {
    const sections = [
      ['Math (instant)', 'Everything MathJax supports — amsmath, mathtools, physics, mhchem, cancel, color, braket, cases, empheq…', SNIPPETS.math.slice(0, 9).map(x => [x[0], mathWrap(x[1])]).concat(SNIPPETS.block.map(x => [x[0], x[1]]))],
      ['Text & layout (instant)', 'Bold, italic, colours, sizes, lists, tables (\\hline, booktabs, \\multicolumn), sections, theorem boxes, code, links, footnotes.', SNIPPETS.text.map(x => [x[0], x[1]])],
      ['Diagrams & any package (real LaTeX)', 'TikZ, pgfplots, circuitikz, tikz-cd, forest, chemfig — or wrap anything in \\begin{latex} … \\end{latex} to use any package, or paste a whole \\documentclass document.', SNIPPETS.diagram.map(x => [x[0], x[1]])]
    ];
    const ov = document.createElement('div');
    ov.className = 'modal-overlay active tex-guide-ov';
    ov.innerHTML = `<div class="modal-box tex-guide" role="dialog" aria-modal="true" aria-label="LaTeX guide">
      <div class="tex-guide-head"><h3><i class="fas fa-circle-question"></i> LaTeX in quizzes</h3><button type="button" class="tex-guide-x" aria-label="Close"><i class="fas fa-xmark"></i></button></div>
      <p class="tex-guide-intro">Write LaTeX exactly as in Overleaf. Math and text appear instantly; diagrams and extra packages are compiled by real TeX Live on the server (a second or two the first time, then instant).</p>
      ${sections.map(([h, d, items], si) => `<div class="tex-guide-sec"><h4>${esc(h)}</h4><p>${esc(d)}</p>${items.map(([n, code], ii) => `
        <div class="tex-guide-item"><div class="tex-guide-item-h"><b>${esc(n)}</b>${field ? `<button type="button" class="btn btn-outline btn-sm" data-ins="${si}:${ii}"><i class="fas fa-plus"></i> Insert</button>` : ''}</div>
        <pre class="tex-code"><code>${esc(code)}</code></pre></div>`).join('')}</div>`).join('')}
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('.tex-guide-x')) { ov.remove(); return; }
      const b = e.target.closest('[data-ins]'); if (!b) return;
      const [si, ii] = b.dataset.ins.split(':').map(Number);
      ov.remove(); insert(field, sections[si][2][ii][1]);
    });
  }

  window.AeroTeX = { prepare, render: renderInto, convert, splitEngine, openEditor, openGuide, version: 1 };
})();
