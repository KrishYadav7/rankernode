/* ============================================================
   RankerNode — desktop app (Windows now, macOS later)
   ------------------------------------------------------------
   A real installed app (not a browser shortcut). It opens the
   RankerNode landing page (https://rankernode.example/) in its own window
   with its own icon, Start-menu / desktop entry and taskbar button;
   "Log in" / "Start learning" lead on to https://rankernode.example/app.
   • Back (mouse back button, Alt+←) closes the site's pop-ups and
     menus first (window.aeroBack), then goes back a page.

   • Screenshots, screen recording and screen sharing show a black
     window (content protection) — like FLAG_SECURE on Android.
   • rankernode.example and Razorpay stay inside the app; YouTube,
     WhatsApp, social and other sites open in the normal browser.
   • Downloads (notes PDF/PNG, exports, materials) are saved to
     Downloads › RankerNode with a notification.
   • Certificates / pop-ups open in an app window; Print works
     (choose "Microsoft Print to PDF" to save a PDF).
   • Offline screen that retries by itself.
   • Updates download in the background from rankernode.example and
     install on restart (Admin → Apps publishes them).
   • The website sees "RankerNodeApp/<version> (Desktop; Windows)"
     in the user-agent and hides its "Get App" buttons.
   ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, session, shell, dialog, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = 'https://rankernode.example/app';
const START_URL = 'https://rankernode.example/';       // first page on launch: the landing page
const APP_ID = 'com.altitudeacademy.app';
const PROTOCOL = 'rankernode';
const IS_MAC = process.platform === 'darwin';
const OS_NAME = IS_MAC ? 'macOS' : (process.platform === 'win32' ? 'Windows' : 'Linux');
const BG = '#0b1226';

/* --aero-selftest=<folder> : used only by the GitHub build to test the app, then it quits */
const SELFTEST_DIR = (() => {
  const a = process.argv.find((x) => x.startsWith('--aero-selftest='));
  return a ? a.slice('--aero-selftest='.length) : null;
})();

/* ---------------------------------------------------------------- hosts */
const EXTERNAL_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com',
  'wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com',
  'play.google.com', 'maps.google.com', 'maps.app.goo.gl',
  'linkedin.com', 'www.linkedin.com', 'instagram.com', 'www.instagram.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'twitter.com', 'x.com', 't.me'
]);
const PAYMENT_DOMAINS = ['razorpay.com', 'razorpay.in', 'rzp.io'];
/* only these schemes are ever handed to Windows / macOS */
const SAFE_EXTERNAL = new Set(['http:', 'https:', 'mailto:', 'tel:', 'whatsapp:', 'tg:']);

function parse(u) { try { return new URL(u); } catch (_) { return null; } }
function hostOf(u) { const p = parse(u); return p ? p.hostname.toLowerCase() : ''; }
function isOwnHost(h) { return h === 'rankernode.example' || h.endsWith('.rankernode.example'); }
function isPaymentHost(h) { return PAYMENT_DOMAINS.some((d) => h === d || h.endsWith('.' + d)); }
function isInAppUrl(u) {                   // pages the MAIN window may show
  const p = parse(u);
  if (!p) return false;
  if (p.protocol !== 'https:') return false;
  return isOwnHost(p.hostname) || isPaymentHost(p.hostname);
}

/* ---------------------------------------------------------------- log */
let LOG_FILE = null;
function log(...args) {
  try {
    if (!LOG_FILE) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      LOG_FILE = path.join(dir, 'main.log');
      try { if (fs.statSync(LOG_FILE).size > 512 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) {}
    }
    const line = new Date().toISOString() + ' ' + args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFileSync(LOG_FILE, line + '\n');
    if (!app.isPackaged || SELFTEST_DIR) console.log(line);
  } catch (_) {}
}
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled', e));

/* hooks the self-test listens to */
const hooks = { external: [], downloads: [], children: [] };

/* ---------------------------------------------------------------- start-up */
if (!IS_MAC) app.setAppUserModelId(APP_ID);          // Windows notifications + taskbar grouping

let mainWin = null;
let pendingDeepLink = null;

const gotLock = SELFTEST_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = (argv || []).find((a) => typeof a === 'string' && a.startsWith(PROTOCOL + '://'));
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      if (link) openDeepLink(link);
    }
  });
  app.on('open-url', (e, url) => {                   // macOS deep links
    e.preventDefault();
    if (mainWin) openDeepLink(url); else pendingDeepLink = url;
  });
  pendingDeepLink = process.argv.find((a) => typeof a === 'string' && a.startsWith(PROTOCOL + '://')) || null;

  app.whenReady().then(onReady).catch((e) => { log('ready failed', e); app.exit(1); });
}

function onReady() {
  log('start', app.getVersion(), 'electron', process.versions.electron, OS_NAME, SELFTEST_DIR ? 'SELFTEST' : '');
  if (app.isPackaged && !SELFTEST_DIR) {
    try { app.setAsDefaultProtocolClient(PROTOCOL); } catch (_) {}
  }
  setupSession(session.defaultSession);
  Menu.setApplicationMenu(IS_MAC ? buildMacMenu() : null);
  createMainWindow();
  setupAutoUpdate();
  if (SELFTEST_DIR) {
    require('./selftest').run({
      app, dir: SELFTEST_DIR, hooks, appUrl: APP_URL,
      getMainWindow: () => mainWin, deepLinkToUrl, log
    });
  }
}

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
app.on('activate', () => { if (!mainWin && app.isReady()) createMainWindow(); });

/* ---------------------------------------------------------------- session */
function setupSession(ses) {
  /* a clean Chrome user-agent + our marker (no "Electron/…" token) */
  const base = ses.getUserAgent()
    .replace(/\sElectron\/\S+/i, '')
    .replace(new RegExp('\\s' + app.getName().replace(/[^A-Za-z0-9]/g, '.') + '\\/\\S+', 'i'), '')
    .replace(/\srankernode(-desktop)?\/\S+/i, '');
  const ua = `${base} RankerNodeApp/${app.getVersion()} (Desktop; ${OS_NAME})`;
  app.userAgentFallback = ua;
  ses.setUserAgent(ua);

  const ALLOWED = new Set(['clipboard-sanitized-write', 'clipboard-read', 'notifications', 'fullscreen', 'media', 'speaker-selection']);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const h = hostOf((details && details.requestingUrl) || (wc && wc.getURL()) || '');
    /* full screen is fine for any embedded player (e.g. a lecture video); the rest only for our site */
    const ok = permission === 'fullscreen' || ((isOwnHost(h) || isPaymentHost(h)) && ALLOWED.has(permission));
    if (!ok) log('permission denied', permission, h);
    cb(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    const h = hostOf(origin || '');
    return permission === 'fullscreen' || isOwnHost(h) || isPaymentHost(h);
  });

  ses.on('will-download', onWillDownload);
}

/* ---------------------------------------------------------------- windows */
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const wa = screen.getPrimaryDisplay().workArea;
  const def = {
    width: Math.min(1360, Math.round(wa.width * 0.9)),
    height: Math.min(880, Math.round(wa.height * 0.9)),
    maximized: wa.width < 1400
  };
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    const b = s && s.bounds;
    if (b && b.width >= 380 && b.height >= 460) {
      const d = screen.getDisplayMatching(b).workArea;          // still on a connected screen?
      const visible = b.x < d.x + d.width - 80 && b.x + b.width > d.x + 80 && b.y >= d.y - 20 && b.y < d.y + d.height - 80;
      if (visible) return { x: b.x, y: b.y, width: b.width, height: b.height, maximized: !!s.maximized };
      return { width: b.width, height: b.height, maximized: !!s.maximized };
    }
  } catch (_) {}
  return def;
}
function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch (_) {}
}

function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    plugins: true,                       // built-in PDF viewer
    spellcheck: true,
    devTools: !app.isPackaged,
    backgroundThrottling: true
  };
}

function createMainWindow() {
  const st = SELFTEST_DIR ? { width: 1280, height: 800, maximized: false } : loadWindowState();
  mainWin = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height,
    minWidth: 380, minHeight: 460,
    show: false,
    title: 'RankerNode',
    backgroundColor: BG,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: webPrefs()
  });
  protect(mainWin);

  let shown = false;
  const show = () => {
    if (shown || !mainWin || mainWin.isDestroyed()) return;
    shown = true;
    if (st.maximized) mainWin.maximize();
    mainWin.show();
  };
  mainWin.once('ready-to-show', show);
  setTimeout(show, 3500);                     // never stay invisible on a slow connection

  mainWin.on('close', () => saveWindowState(mainWin));
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.on('app-command', (_e, cmd) => {      // mouse back / forward buttons
    if (cmd === 'browser-backward') goBack(mainWin.webContents);
    if (cmd === 'browser-forward') goForward(mainWin.webContents);
  });

  const wc = mainWin.webContents;
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;                 // -3 = aborted (e.g. a download)
    if (!/^https?:/i.test(String(url || ''))) return;
    log('load failed', code, desc, url);
    wc.loadFile(path.join(__dirname, 'offline.html'), { query: { u: String(url), c: String(code) } }).catch(() => {});
  });
  wc.on('render-process-gone', async (_e, details) => {
    log('renderer gone', details && details.reason);
    if (!mainWin || mainWin.isDestroyed() || (details && details.reason === 'clean-exit')) return;
    if (SELFTEST_DIR) return wc.reload();
    const r = await dialog.showMessageBox(mainWin, {
      type: 'warning', buttons: ['Reload', 'Close'], defaultId: 0, cancelId: 1,
      title: 'RankerNode', message: 'RankerNode stopped unexpectedly.', detail: 'Reload to continue where you were.'
    });
    if (r.response === 0) wc.reload(); else mainWin.close();
  });

  const start = pendingDeepLink ? (deepLinkToUrl(pendingDeepLink) || START_URL) : START_URL;
  pendingDeepLink = null;
  wc.loadURL(start).catch(() => {});          // failures are shown by did-fail-load
}

function protect(win) {
  try { win.setContentProtection(true); } catch (e) { log('content protection failed', e); }
}

function childWindowOptions(parent) {
  const pb = parent && !parent.isDestroyed() ? parent.getBounds() : null;
  const width = pb ? Math.max(720, Math.min(1100, pb.width - 80)) : 1000;
  const height = pb ? Math.max(560, Math.min(860, pb.height - 60)) : 760;
  return {
    width, height,
    minWidth: 360, minHeight: 360,
    parent: IS_MAC ? undefined : parent || undefined,
    show: true,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    title: 'RankerNode',
    webPreferences: webPrefs()
  };
}

/* every web page the app creates (main window, pop-ups) gets the same rules */
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());

  contents.setWindowOpenHandler(({ url }) => {
    const p = parse(url);
    const scheme = p ? p.protocol : '';
    const inApp = url === '' || url === 'about:blank' || scheme === 'blob:' || scheme === 'data:' ||
                  (scheme === 'https:' && (isOwnHost(p.hostname) || isPaymentHost(p.hostname)));
    if (inApp) {
      const parent = BrowserWindow.fromWebContents(contents) || mainWin;
      return { action: 'allow', overrideBrowserWindowOptions: childWindowOptions(parent) };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (child) => {
    protect(child);
    try { child.setMenu(null); } catch (_) {}
    hooks.children.push(child);
  });

  contents.on('will-navigate', (e, navUrl) => {
    const url = navUrl || (e && e.url) || '';
    const isMain = mainWin && !mainWin.isDestroyed() && contents === mainWin.webContents;
    const p = parse(url);
    if (!p) { e.preventDefault(); return; }
    if (isMain) {
      if (isInAppUrl(url)) return;
      e.preventDefault();
      openExternal(url);
      return;
    }
    /* pop-ups (payment / bank pages, certificates) may go anywhere on https,
       except the sites that have their own apps */
    if (p.protocol === 'https:' || p.protocol === 'http:') {
      if (EXTERNAL_HOSTS.has(p.hostname.toLowerCase())) { e.preventDefault(); openExternal(url); }
      return;
    }
    if (p.protocol === 'about:' || p.protocol === 'blob:' || p.protocol === 'data:') return;
    e.preventDefault();
    openExternal(url);
  });

  contents.on('zoom-changed', (_e, dir) => zoom(contents, dir === 'in' ? 1 : -1));
  contents.on('before-input-event', (e, input) => onKey(contents, e, input));
  contents.on('context-menu', (_e, params) => contextMenu(contents, params));
});

function openExternal(url) {
  const p = parse(url);
  if (!p || !SAFE_EXTERNAL.has(p.protocol)) { log('blocked external', url); return; }
  hooks.external.push(url);
  if (SELFTEST_DIR) return;                       // the test only records it
  shell.openExternal(url).catch((e) => log('openExternal failed', e));
}

/* ---------------------------------------------------------------- keys, zoom, menu */
function historyBack(wc) {
  const h = wc.navigationHistory;
  if (h && h.canGoBack()) h.goBack(); else if (!h && wc.canGoBack && wc.canGoBack()) wc.goBack();
}
/* the website first closes its own pop-up / menu (or goes up a page) */
function goBack(wc) {
  let host = '';
  try { host = new URL(wc.getURL()).hostname; } catch (_) {}
  if (!/(^|\.)rankernode\.tech$/i.test(host)) return historyBack(wc);
  wc.executeJavaScript('(function(){try{return !!(window.aeroBack&&window.aeroBack());}catch(e){return false;}})()', true)
    .then((handled) => { if (!handled) historyBack(wc); })
    .catch(() => historyBack(wc));
}
function goForward(wc) {
  const h = wc.navigationHistory;
  if (h && h.canGoForward()) h.goForward(); else if (!h && wc.canGoForward && wc.canGoForward()) wc.goForward();
}
function zoom(wc, step) {
  if (step === 0) { wc.setZoomLevel(0); return; }
  const z = Math.max(-3, Math.min(4, wc.getZoomLevel() + step * 0.5));
  wc.setZoomLevel(z);
}

function onKey(wc, e, input) {
  if (input.type !== 'keyDown') return;
  const mod = IS_MAC ? input.meta : input.control;
  const k = String(input.key || '');
  const win = BrowserWindow.fromWebContents(wc);
  const act = (fn) => { e.preventDefault(); fn(); };

  if (k === 'F5' || (mod && k.toLowerCase() === 'r')) {
    return act(() => (input.shift || (mod && k === 'F5') ? wc.reloadIgnoringCache() : wc.reload()));
  }
  if (k === 'F11' && !IS_MAC && win) return act(() => win.setFullScreen(!win.isFullScreen()));
  if (mod && (k === '=' || k === '+' || k === 'Add')) return act(() => zoom(wc, 1));
  if (mod && (k === '-' || k === '_' || k === 'Subtract')) return act(() => zoom(wc, -1));
  if (mod && k === '0') return act(() => zoom(wc, 0));
  if ((input.alt && !IS_MAC && k === 'ArrowLeft') || (IS_MAC && input.meta && k === '[')) return act(() => goBack(wc));
  if ((input.alt && !IS_MAC && k === 'ArrowRight') || (IS_MAC && input.meta && k === ']')) return act(() => goForward(wc));
  if (mod && k.toLowerCase() === 'w' && win && win !== mainWin) return act(() => win.close());
  if (!app.isPackaged && mod && input.shift && k.toLowerCase() === 'i') return act(() => wc.toggleDevTools());
}

function contextMenu(wc, p) {
  const items = [];
  if (p.misspelledWord && Array.isArray(p.dictionarySuggestions) && p.dictionarySuggestions.length) {
    p.dictionarySuggestions.slice(0, 5).forEach((s) => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    const f = p.editFlags || {};
    items.push(
      { label: 'Undo', role: 'undo', enabled: f.canUndo !== false },
      { label: 'Redo', role: 'redo', enabled: f.canRedo !== false },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: !!f.canCut },
      { label: 'Copy', role: 'copy', enabled: !!f.canCopy },
      { label: 'Paste', role: 'paste', enabled: !!f.canPaste },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll' }
    );
  }
  if (!items.length) return;
  Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) || undefined });
}

function buildMacMenu() {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]);
}

/* ---------------------------------------------------------------- downloads */
function cleanName(name) {
  let n = String(name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
  if (!n) n = 'download';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = '_' + n;
  return n.slice(0, 150);
}
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}

function onWillDownload(_event, item, wc) {
  const dir = path.join(app.getPath('downloads'), 'RankerNode');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const target = uniquePath(dir, cleanName(item.getFilename()));
  item.setSavePath(target);
  log('download', item.getURL().slice(0, 120), '→', target);

  item.on('updated', (_e, state) => {
    if (!mainWin || mainWin.isDestroyed()) return;
    const total = item.getTotalBytes();
    if (state === 'progressing' && total > 0) mainWin.setProgressBar(item.getReceivedBytes() / total);
  });
  item.once('done', (_e, state) => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.setProgressBar(-1);
    hooks.downloads.push({ path: target, state });
    const name = path.basename(target);
    if (state === 'completed') {
      toastInPage(wc, `Saved to Downloads › RankerNode › ${name}`, 'success');
      notify('Saved to Downloads › RankerNode', name, () => shell.showItemInFolder(target));
    } else if (state !== 'cancelled') {
      toastInPage(wc, 'Download failed — please try again.', 'error');
    }
  });
}

function toastInPage(wc, msg, type) {
  try {
    if (!wc || wc.isDestroyed() || !isOwnHost(hostOf(wc.getURL()))) return;
    wc.executeJavaScript(`window.showToast && window.showToast(${JSON.stringify(msg)}, ${JSON.stringify(type)})`).catch(() => {});
  } catch (_) {}
}

function notify(title, body, onClick) {
  try {
    if (SELFTEST_DIR || !Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: path.join(__dirname, 'icon.png'), silent: true });
    if (onClick) n.on('click', onClick);
    n.show();
  } catch (_) {}
}

/* ---------------------------------------------------------------- deep links */
/* rankernode://open/courses → https://rankernode.example/courses
   rankernode://app#/notes   → https://rankernode.example/app#/notes */
function deepLinkToUrl(link) {
  const p = parse(link);
  if (!p || p.protocol !== PROTOCOL + ':') return null;
  const host = (p.hostname || '').toLowerCase();
  let pathname = p.pathname || '/';
  if (host && host !== 'open') pathname = '/' + host + (pathname === '/' ? '' : pathname);
  const out = parse('https://rankernode.example' + (pathname.startsWith('/') ? pathname : '/' + pathname) + p.search + p.hash);
  return out && isOwnHost(out.hostname) ? out.toString() : null;
}
function openDeepLink(link) {
  const url = deepLinkToUrl(link);
  if (url && mainWin && !mainWin.isDestroyed()) mainWin.webContents.loadURL(url).catch(() => {});
}

/* ---------------------------------------------------------------- updates */
function setupAutoUpdate() {
  if (!app.isPackaged || SELFTEST_DIR || IS_MAC) return;      // macOS updates need a signed app
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { log('updater missing', e); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => log('[update]', m), warn: (m) => log('[update]', m), error: (m) => log('[update]', m), debug: () => {} };

  let asked = null;
  autoUpdater.on('error', (e) => log('[update] error', e && e.message));
  autoUpdater.on('update-downloaded', async (info) => {
    if (!info || asked === info.version || !mainWin || mainWin.isDestroyed()) return;
    asked = info.version;
    const r = await dialog.showMessageBox(mainWin, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready',
      message: `RankerNode ${info.version} is ready to install`,
      detail: 'Restart RankerNode to finish the update. If you choose Later, it installs the next time you close the app.'
    });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  const check = () => { autoUpdater.checkForUpdates().catch((e) => log('[update] check failed', e && e.message)); };
  setTimeout(check, 20 * 1000);
  setInterval(check, 6 * 60 * 60 * 1000);
}
