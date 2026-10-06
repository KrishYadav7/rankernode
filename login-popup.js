/* ============================================================
   RANKERNODE — ANNOUNCEMENT POP-UP (landing page + login page)
   (2026-10-04)
   ------------------------------------------------------------
   Shows the pop-up the admin switched on in Admin → Login Pop-up:
   festival greetings, exam wishes, notices. It closes by itself
   after the admin's timer, or earlier with ✕ / Esc / a click
   outside.

   window.AeroLoginPopup.preview(popup)  — used by the admin editor.
   The HTML is cleaned again here (whitelist) before it is shown.
   ============================================================ */
(function () {
  'use strict';
  if (window.AeroLoginPopup) return;

  const TAGS = new Set(['P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP',
    'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'IMG', 'BLOCKQUOTE', 'HR', 'FONT', 'SMALL', 'BIG', 'MARK']);
  const STYLE_PROPS = new Set(['color', 'background-color', 'background', 'font-size', 'font-weight', 'font-style',
    'font-family', 'text-decoration', 'text-align', 'line-height', 'letter-spacing', 'margin', 'margin-top',
    'margin-bottom', 'margin-left', 'margin-right', 'padding', 'width', 'max-width', 'height', 'border-radius',
    'display', 'vertical-align', 'text-transform']);

  function safeUrl(u, img) {
    const v = String(u || '').trim();
    if (!v || /[\u0000-\u001f<>"'`\\]/.test(v)) return '';
    if (img) return /^(https:\/\/|\/popup-media\/|\/uploads\/)/i.test(v) ? v : '';
    return /^(https?:\/\/|mailto:|\/|#)/i.test(v) && !/^\/\//.test(v) ? v : '';
  }
  function safeStyle(el) {
    const keep = [];
    for (let i = 0; i < el.style.length; i++) {
      const p = el.style[i];
      const v = el.style.getPropertyValue(p);
      if (!STYLE_PROPS.has(p) || !v || /url\s*\(|expression|javascript:/i.test(v)) continue;
      keep.push(p + ':' + v);
    }
    return keep.join(';');
  }
  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
    const root = doc.body.firstChild;
    (function walk(node) {
      Array.from(node.childNodes).forEach(ch => {
        if (ch.nodeType === 3) return;
        if (ch.nodeType !== 1 || !TAGS.has(ch.tagName)) {
          if (ch.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT|SVG|MATH|TEXTAREA|SELECT|BUTTON|FORM)$/.test(ch.tagName)) {
            walk(ch);
            while (ch.firstChild) node.insertBefore(ch.firstChild, ch);   // keep the text, drop the tag
          }
          ch.remove();
          return;
        }
        Array.from(ch.attributes).forEach(a => {
          const n = a.name.toLowerCase();
          let ok = false;
          if (n === 'style') { const s = safeStyle(ch); if (s) { ch.setAttribute('style', s); ok = true; } }
          else if (n === 'href' && ch.tagName === 'A') { const u = safeUrl(a.value, false); if (u) { ch.setAttribute('href', u); ok = true; } }
          else if (n === 'src' && ch.tagName === 'IMG') { const u = safeUrl(a.value, true); if (u) { ch.setAttribute('src', u); ok = true; } }
          else if (n === 'alt' || n === 'title' || n === 'width' || n === 'height' || n === 'align') ok = true;
          else if ((n === 'color' || n === 'size') && ch.tagName === 'FONT') ok = true;
          if (!ok) ch.removeAttribute(a.name);
        });
        if (ch.tagName === 'A') { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener noreferrer'); }
        if (ch.tagName === 'IMG') {
          if (!ch.getAttribute('src')) { ch.remove(); return; }
          ch.setAttribute('loading', 'eager'); ch.setAttribute('decoding', 'async'); ch.setAttribute('draggable', 'false');
        }
        walk(ch);
      });
    })(root);
    return root.innerHTML;
  }
  function color(v, d) {
    const s = String(v || '').trim();
    return /^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\([\d\s.,%]+\)$/i.test(s) ? s : d;
  }

  const CSS = `
    .agp-overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(2, 6, 23, .58); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
      opacity: 0; transition: opacity .25s ease; }
    .agp-overlay.agp-in { opacity: 1; }
    .agp-card { position: relative; width: 100%; max-height: calc(100vh - 40px); max-height: calc(100dvh - 40px);
      display: flex; flex-direction: column; border-radius: 20px; overflow: hidden;
      box-shadow: 0 30px 80px rgba(2, 6, 23, .45), 0 0 0 1px rgba(255, 255, 255, .06);
      transform: translateY(14px) scale(.96); transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
    .agp-overlay.agp-in .agp-card { transform: none; }
    .agp-card:focus { outline: none; }
    .agp-sm { max-width: 400px; } .agp-md { max-width: 540px; } .agp-lg { max-width: 760px; }
    .agp-body { overflow-y: auto; padding: 28px 26px 22px; font: 400 15px/1.6 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
      overflow-wrap: anywhere; -webkit-user-select: text; user-select: text; }
    .agp-body > :first-child { margin-top: 0; } .agp-body > :last-child { margin-bottom: 0; }
    .agp-body h1 { font-size: 30px; line-height: 1.2; margin: .3em 0; font-weight: 800; }
    .agp-body h2 { font-size: 23px; line-height: 1.25; margin: .35em 0; font-weight: 800; }
    .agp-body h3 { font-size: 18px; margin: .4em 0; font-weight: 700; }
    .agp-body p { margin: .45em 0; }
    .agp-body img { max-width: 100%; height: auto; border-radius: 12px; display: inline-block; }
    .agp-body a { color: inherit; text-decoration: underline; font-weight: 600; }
    .agp-body ul, .agp-body ol { padding-left: 1.3em; margin: .4em 0; }
    .agp-body blockquote { margin: .6em 0; padding: .4em 1em; border-left: 4px solid currentColor; opacity: .9; }
    .agp-body hr { border: 0; border-top: 1px solid currentColor; opacity: .25; margin: 1em 0; }
    .agp-actions { padding: 0 26px 22px; display: flex; justify-content: center; }
    .agp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 26px;
      border-radius: 999px; color: #fff; font: 700 15px/1 Inter, system-ui, sans-serif; text-decoration: none;
      box-shadow: 0 10px 24px rgba(2, 6, 23, .25); }
    .agp-btn:hover { filter: brightness(1.08); }
    .agp-close { position: absolute; top: 10px; right: 10px; z-index: 2; width: 38px; height: 38px; border-radius: 50%;
      border: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;
      background: rgba(15, 23, 42, .55); color: #fff; font: 400 22px/1 system-ui, sans-serif;
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
    .agp-close:hover { background: rgba(15, 23, 42, .8); }
    .agp-close:focus-visible { outline: 3px solid #22d3ee; outline-offset: 2px; }
    .agp-timer { height: 4px; background: rgba(127, 127, 127, .22); flex-shrink: 0; }
    .agp-timer i { display: block; height: 100%; width: 100%; transform-origin: left center; }
    .agp-preview-tag { position: absolute; top: 14px; left: 14px; z-index: 2; padding: 4px 10px; border-radius: 999px;
      background: #f59e0b; color: #1f1300; font: 800 11px/1.4 system-ui, sans-serif; letter-spacing: .5px; }
    @media (max-width: 520px) {
      .agp-overlay { padding: 14px; }
      .agp-body { padding: 24px 18px 18px; font-size: 14.5px; }
      .agp-body h1 { font-size: 25px; } .agp-body h2 { font-size: 20px; }
      .agp-actions { padding: 0 18px 18px; }
      .agp-btn { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) { .agp-overlay, .agp-card { transition: none; } }
  `;
  function ensureCss() {
    if (document.getElementById('agpStyle')) return;
    const s = document.createElement('style');
    s.id = 'agpStyle';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  let current = null;
  function close() {
    if (!current) return;
    const c = current; current = null;
    c.stop();
    c.el.classList.remove('agp-in');
    document.removeEventListener('keydown', c.onKey, true);
    setTimeout(() => { c.el.remove(); }, 260);
    try { if (c.prevFocus && c.prevFocus.focus) c.prevFocus.focus(); } catch (_) {}
  }

  function show(p, opts) {
    opts = opts || {};
    if (!p || !document.body) return;
    close();
    ensureCss();
    const d = p.design || {};
    const bg1 = color(d.bg1, '#ffffff');
    const bg2 = d.bg2 ? color(d.bg2, '') : '';
    const text = color(d.textColor, '#0f172a');
    const accent = color(d.accent, '#4f46e5');
    const size = ['sm', 'md', 'lg'].includes(d.width) ? d.width : 'md';
    const dur = Math.max(0, Math.min(120, Number(p.durationSec) || 0));

    const ov = document.createElement('div');
    ov.className = 'agp-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Announcement');
    const card = document.createElement('div');
    card.className = 'agp-card agp-' + size;
    card.tabIndex = -1;                       // focus lands here (Tab reaches ✕), no ring on open
    card.style.background = bg2 ? `linear-gradient(135deg, ${bg1}, ${bg2})` : bg1;
    card.style.color = text;

    const x = document.createElement('button');
    x.type = 'button'; x.className = 'agp-close'; x.setAttribute('aria-label', 'Close announcement'); x.innerHTML = '&times;';
    card.appendChild(x);
    if (opts.preview) { const t = document.createElement('span'); t.className = 'agp-preview-tag'; t.textContent = 'PREVIEW'; card.appendChild(t); }

    const body = document.createElement('div');
    body.className = 'agp-body';
    body.innerHTML = sanitize(p.html);
    card.appendChild(body);

    const btn = p.button || {};
    const href = safeUrl(btn.url, false);
    if (btn.text && href) {
      const wrap = document.createElement('div'); wrap.className = 'agp-actions';
      const a = document.createElement('a');
      a.className = 'agp-btn'; a.href = href; a.textContent = String(btn.text).slice(0, 60);
      a.style.background = accent;
      if (/^https?:/i.test(href) && !href.startsWith(location.origin)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.addEventListener('click', () => setTimeout(close, 50));
      wrap.appendChild(a); card.appendChild(wrap);
    }

    let bar = null;
    if (dur > 0) {
      const t = document.createElement('div'); t.className = 'agp-timer';
      bar = document.createElement('i'); bar.style.background = accent;
      t.appendChild(bar); card.appendChild(t);
      card.setAttribute('title', '');
    }
    ov.appendChild(card);

    /* Countdown — exactly the admin's time; it only waits while the tab is hidden */
    let remaining = dur * 1000, last = 0, raf = 0, running = dur > 0;
    function frame(ts) {
      if (!running) return;
      if (!last) last = ts;
      if (!document.hidden) remaining -= (ts - last);
      last = ts;
      if (bar) bar.style.transform = 'scaleX(' + Math.max(0, remaining / (dur * 1000)) + ')';
      if (remaining <= 0) { close(); return; }
      raf = requestAnimationFrame(frame);
    }

    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    x.addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey, true);

    current = { el: ov, onKey, prevFocus: document.activeElement, stop() { running = false; cancelAnimationFrame(raf); } };
    document.body.appendChild(ov);
    requestAnimationFrame(() => { ov.classList.add('agp-in'); try { card.focus({ preventScroll: true }); } catch (_) {} });
    if (running) raf = requestAnimationFrame(frame);

    /* Images that fail to load are hidden instead of showing a broken icon */
    body.querySelectorAll('img').forEach(im => im.addEventListener('error', () => { im.style.display = 'none'; }));
  }

  /* ---------- automatic display ---------- */
  function seenKey(p) { return 'aero_popup_' + p.id + '_' + (p.version || 1); }
  function alreadySeen(p) {
    try {
      if (p.frequency === 'always') return false;
      if (p.frequency === 'once') return !!localStorage.getItem(seenKey(p));
      return !!sessionStorage.getItem(seenKey(p));
    } catch (_) { return false; }
  }
  function markSeen(p) {
    try {
      if (p.frequency === 'once') localStorage.setItem(seenKey(p), '1');
      else if (p.frequency !== 'always') sessionStorage.setItem(seenKey(p), '1');
    } catch (_) {}
  }
  function loggedIn() { try { return !!sessionStorage.getItem('aero_token'); } catch (_) { return false; } }
  function pageKind() {
    if (document.getElementById('landingPage')) return 'landing';
    if (document.getElementById('loginView')) return 'login';
    return '';
  }
  function loginVisible() {
    const v = document.getElementById('loginView');
    if (!v || loggedIn()) return false;
    const st = getComputedStyle(v);
    return st.display !== 'none' && st.visibility !== 'hidden' && v.offsetParent !== null;
  }

  async function auto() {
    const kind = pageKind();
    if (!kind) return;
    if (kind === 'login' && loggedIn()) return;            // students already inside the app
    let p = null;
    try {
      const r = await fetch('/api/login-popup', { credentials: 'same-origin', cache: 'no-store' });
      const data = await r.json();
      p = data && data.popup;
    } catch (_) { return; }
    if (!p || (p.showOn !== 'both' && p.showOn !== kind) || alreadySeen(p)) return;

    /* login page: wait until the app has actually shown the login form */
    let tries = 0;
    (function waitAndShow() {
      if (kind === 'login' && !loginVisible()) {
        if (++tries > 20) return;                          // ~6 s, then give up quietly
        return setTimeout(waitAndShow, 300);
      }
      markSeen(p);
      show(p);
    })();
  }

  window.AeroLoginPopup = {
    preview(p) { show(p, { preview: true }); },
    close,
    sanitize
  };

  function start() { setTimeout(auto, 700); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
