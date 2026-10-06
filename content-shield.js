/* ============================================================
   RANKERNODE CONTENT SHIELD — site-wide capture deterrence
   (rev. 2026-10-04b)
   ------------------------------------------------------------
   The "Content protected" window appears ONLY at the moment a
   capture is attempted — never on tab switches, app switches,
   notifications or focus changes (that behaviour was removed).

   Triggers:
     1. Screenshot shortcuts — PrintScreen, Cmd+Shift+3/4/5/6,
        Ctrl/Cmd+Shift+S — black-out cover + clipboard poisoned.
     2. Three-finger touch — the screenshot gesture on many Android
        phones (Xiaomi/Redmi/POCO, OnePlus, Oppo, Realme, Vivo…).
        The cover goes up on the first touch, before the OS saves
        the image.
     3. Print (Ctrl/Cmd+P) and the browser screen-recording API
        (getDisplayMedia).
   Always on: no right-click, text selection, drag-to-desktop,
   copy, view-source or DevTools shortcuts outside form fields;
   printing blanked by the print stylesheet. No visible
   watermarks (removed at the owner's request). Every attempt is
   logged on the server against the student's account.

   What NO website can do: detect or block the hardware-button
   screenshot on a phone (Power+Volume on Android/iPhone) or a
   phone's built-in screen recorder — the browser is never told.
   Only a native app can (Android FLAG_SECURE). The server-side
   access log still records who opened which file and when.
   ============================================================ */
(function () {
  'use strict';
  if (window.__AERO_SHIELD__) return;
  window.__AERO_SHIELD__ = true;

  const CFG = Object.assign({
    report: true              // log capture attempts to the server
  }, window.AERO_SHIELD_CONFIG || {});

  const ALLOW_SEL = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .allow-select, .pdfv-pages, .quiz-answer-input';

  function currentUser() {
    try { return JSON.parse(sessionStorage.getItem('aero_user') || 'null'); } catch (e) { return null; }
  }
  function isAdmin() {
    const u = currentUser();
    return !!(u && String(u.role || '').toLowerCase() === 'admin');
  }

  /* ---------- 1. Styles ---------- */
  const css = `
    html.aero-shield body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    html.aero-shield :is(${ALLOW_SEL}), html.aero-shield :is(${ALLOW_SEL}) * { -webkit-user-select: text; user-select: text; }
    html.aero-shield img, html.aero-shield canvas, html.aero-shield video { -webkit-user-drag: none; user-drag: none; }
    #aeroShieldCover {
      position: fixed; inset: 0; z-index: 2147483647; display: none;
      align-items: center; justify-content: center; flex-direction: column; gap: 12px;
      background: radial-gradient(circle at 50% 40%, #1e1b4b 0%, #0b1226 70%); color: #e2e8f0;
      font: 500 15px Inter, system-ui, sans-serif; text-align: center; padding: 24px; cursor: pointer;
    }
    #aeroShieldCover.on { display: flex; }
    #aeroShieldCover .s-ic { width: 64px; height: 64px; border-radius: 18px; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #6366f1, #06b6d4); font-size: 28px; box-shadow: 0 10px 30px rgba(99,102,241,.4); }
    #aeroShieldCover strong { font-size: 19px; color: #fff; }
    #aeroShieldCover small { color: #94a3b8; font-size: 13px; max-width: 420px; line-height: 1.5; }
    #aeroShieldWm, .pdfv-watermark, .vp-watermark, .docv-watermark, .pdfv-present-wm { display: none !important; }
    @media print {
      html body > * { display: none !important; }
      html body::before {
        content: "Printing is disabled on RankerNode to protect course content.";
        display: block !important; margin: 40vh auto 0; text-align: center; font: 600 18px sans-serif; color: #111;
      }
    }
  `;
  const style = document.createElement('style');
  style.id = 'aeroShieldStyle';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  document.documentElement.classList.add('aero-shield');

  /* ---------- 2. Cover ---------- */
  let cover = null, coverTimer = null, coverReason = '';
  function ensureCover() {
    if (cover || !document.body) return cover;
    cover = document.createElement('div');
    cover.id = 'aeroShieldCover';
    cover.setAttribute('role', 'alert');
    cover.innerHTML = '<div class="s-ic">🔒</div><strong>Content protected</strong><small id="aeroShieldMsg"></small>';
    cover.addEventListener('click', () => hide());
    document.body.appendChild(cover);
    return cover;
  }
  function show(reason, ms) {
    if (!ensureCover()) return;
    coverReason = reason;
    const msg = cover.querySelector('#aeroShieldMsg');
    if (msg) {
      msg.textContent = 'Screenshots and screen recording are not permitted on RankerNode. This attempt has been recorded.';
    }
    cover.classList.add('on');
    clearTimeout(coverTimer);
    if (ms) coverTimer = setTimeout(hide, ms);
  }
  function hide() {
    if (!cover) return;
    clearTimeout(coverTimer); coverTimer = null;
    cover.classList.remove('on');
    coverReason = '';
  }

  /* ---------- 3. Report ---------- */
  let lastReport = 0;
  function report(kind) {
    if (!CFG.report) return;
    const now = Date.now();
    if (now - lastReport < 8000) return;
    lastReport = now;
    let token = null;
    try { token = sessionStorage.getItem('aero_token'); } catch (e) {}
    if (!token) return;
    try {
      fetch('/api/security/capture-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ kind, path: (location.hash || location.pathname).slice(0, 120) }),
        keepalive: true
      }).catch(() => {});
    } catch (e) {}
  }

  function poisonClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('Content protected — screenshots are not permitted on RankerNode.').catch(() => {});
      }
    } catch (e) {}
  }

  /* One capture attempt = one cover. Key auto-repeat and the
     PrintScreen keydown+keyup pair only extend the cover that is
     already showing; they never stack a second popup. */
  function onCapture(kind) {
    const already = !!(cover && cover.classList.contains('on') && coverReason === 'capture');
    show('capture', 2500);
    if (already) return;
    poisonClipboard();
    report(kind);
  }

  /* ---------- 4. Keyboard ---------- */
  function inField(t) {
    return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }
  document.addEventListener('keydown', (e) => {
    const k = e.key || '';
    const mod = e.metaKey || e.ctrlKey;
    if (k === 'PrintScreen' || e.keyCode === 44) { e.preventDefault(); onCapture('printscreen'); return; }
    if (e.shiftKey && (e.metaKey || e.ctrlKey) && ['3', '4', '5', '6', 's', 'S', '#', '$', '%', '^'].includes(k)) {
      e.preventDefault(); e.stopPropagation(); onCapture('shortcut'); return;
    }
    if (mod && !e.shiftKey && (k === 'p' || k === 'P')) { e.preventDefault(); e.stopPropagation(); onCapture('print'); return; }
    if (mod && !e.shiftKey && (k === 's' || k === 'S' || k === 'u' || k === 'U')) { e.preventDefault(); e.stopPropagation(); return; }
    if (k === 'F12' || (mod && e.shiftKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(k)) ||
        (e.metaKey && e.altKey && ['I', 'J', 'C', 'i', 'j', 'c'].includes(k))) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (mod && (k === 'c' || k === 'C' || k === 'x' || k === 'X') && !inField(e.target) && !allowedSelection()) {
      e.preventDefault();
    }
  }, true);
  /* Windows only reports PrintScreen on key-UP */
  document.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen' || e.keyCode === 44) { e.preventDefault(); onCapture('printscreen'); }
  }, true);

  function allowedSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return false;
      const n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      return !!(n && n.closest && n.closest(ALLOW_SEL));
    } catch (e) { return false; }
  }

  /* ---------- 5. Mouse / clipboard ---------- */
  document.addEventListener('contextmenu', (e) => { if (!inField(e.target)) e.preventDefault(); }, true);
  document.addEventListener('dragstart', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'IMG' || t.tagName === 'CANVAS' || t.tagName === 'VIDEO' || t.tagName === 'A')) e.preventDefault();
  }, true);
  ['copy', 'cut'].forEach(evt => document.addEventListener(evt, (e) => {
    if (inField(e.target)) return;
    /* Text the student may copy: their own typing, the AI Doubt Solver's
       answers (.allow-select) and the PDF viewer, which applies its own
       copy rules on top. */
    if (allowedSelection()) return;
    e.preventDefault();
  }, true));
  window.addEventListener('beforeprint', () => { report('print'); });

  /* ---------- 6. Mobile screenshot gesture ----------
     Many Android skins take a screenshot with a three-finger
     swipe. The page still receives the touchstart, so the cover
     goes up instantly and is what ends up in the saved image.
     Nothing else (tab/app switch, notifications, focus loss)
     shows the cover any more. */
  let multiTouchActive = false;
  /* iPhone / iPad: three fingers mean copy / paste / undo there, never
     a screenshot — so no cover on Apple touch devices (it would only be
     a false alarm). */
  const IS_APPLE_TOUCH = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (/Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1);
  document.addEventListener('touchstart', (e) => {
    if (IS_APPLE_TOUCH) return;
    if (!e.touches || e.touches.length < 3) return;
    if (inField(e.target)) return;
    multiTouchActive = true;
    onCapture('touch-gesture');
  }, { capture: true, passive: true });
  function endMultiTouch(e) {
    if (!multiTouchActive) return;
    if (e.touches && e.touches.length >= 3) return;
    multiTouchActive = false;
    show('capture', 1500);          // keep covered briefly while the OS saves
  }
  document.addEventListener('touchend', endMultiTouch, { capture: true, passive: true });
  document.addEventListener('touchcancel', endMultiTouch, { capture: true, passive: true });

  /* ---------- 7. Screen-recording API ---------- */
  try {
    const md = navigator.mediaDevices;
    if (md && typeof md.getDisplayMedia === 'function' && !md.__aeroShielded) {
      md.getDisplayMedia = function () {
        onCapture('screen-record');
        return Promise.reject(new DOMException('Screen capture is disabled on RankerNode.', 'NotAllowedError'));
      };
      md.__aeroShielded = true;
    }
  } catch (e) {}

  /* ---------- 8. Boot ---------- */
  /* Remove any visible watermark layer an older cached script may have left. */
  function boot() {
    ensureCover();
    try { const old = document.getElementById('aeroShieldWm'); if (old) old.remove(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.AeroShield = {
    cover: show, uncover: () => hide(),
    suspend() { /* kept for backward compatibility — focus cover removed */ }
  };
})();
