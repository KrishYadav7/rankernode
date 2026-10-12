/* ============================================================
   Self-test — run only by the GitHub build:
     RankerNode.exe --aero-selftest=<folder>
   Opens the real website in the real app window, checks the
   things students rely on, writes report.txt / report.json and
   screenshots into <folder>, then quits (exit code 0 = all OK).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, everyMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (_) {}
    await sleep(everyMs);
  }
  return null;
}

exports.run = async function run(ctx) {
  const { app, dir, hooks, appUrl, getMainWindow, deepLinkToUrl, log } = ctx;
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  const results = [];
  let problems = 0;
  const rec = (status, name, detail) => {
    if (status === 'FAIL') problems++;
    results.push({ status, name, detail: detail || '' });
    lines.push(`${status.padEnd(5)} ${name}${detail ? ' — ' + detail : ''}`);
    log('[selftest]', status, name, detail || '');
  };
  const pass = (n, d) => rec('PASS', n, d);
  const fail = (n, d) => rec('FAIL', n, d);
  const info = (n, d) => rec('info', n, d);

  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    lines.push('');
    lines.push(`RESULT: ${problems === 0 ? 'all checks passed' : problems + ' problem(s) found'}`);
    try { fs.writeFileSync(path.join(dir, 'report.txt'), lines.join('\n') + '\n'); } catch (_) {}
    try { fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ problems, results }, null, 1)); } catch (_) {}
    setTimeout(() => app.exit(code != null ? code : (problems ? 1 : 0)), 300);
  };
  setTimeout(() => { fail('test finished in time', 'stopped after 180 s'); finish(2); }, 180 * 1000);

  const shot = async (wc, name) => {
    try {
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(dir, name), img.toPNG());
      info('screenshot', name + ' (' + img.getSize().width + '×' + img.getSize().height + ')');
    } catch (e) { info('screenshot ' + name, 'failed: ' + e.message); }
  };

  try {
    info('version', `RankerNode ${app.getVersion()} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · ${process.platform} ${process.arch}`);
    const t0 = Date.now();
    const win = await waitUntil(() => getMainWindow(), 15000);
    if (!win) { fail('main window opens'); return finish(); }
    pass('main window opens');
    const wc = win.webContents;

    /* 1. the website loads */
    const loaded = await waitUntil(() => {
      const u = wc.getURL();
      return /^https:\/\/([a-z0-9-]+\.)*rankernode\.tech\//i.test(u) && !wc.isLoading() ? u : null;
    }, 60000);
    if (loaded) pass('website loads in the app', `${loaded} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    else { fail('website loads in the app', 'now at ' + wc.getURL()); await shot(wc, '00-not-loaded.png'); return finish(); }
    await waitUntil(() => win.isVisible(), 5000);
    win.isVisible() ? pass('window is visible') : fail('window is visible');
    await sleep(4000);                                        // let the page settle

    /* 2. screenshots blocked */
    if (typeof win.isContentProtected === 'function') {
      win.isContentProtected() ? pass('screenshots / screen recording blocked (content protection)') : fail('screenshots / screen recording blocked (content protection)');
    } else info('content protection', 'set (this Electron cannot report it)');

    /* 3. what the website sees */
    const page = await wc.executeJavaScript(`(() => {
      const pill = document.getElementById('appInstallPill') || document.getElementById('landingInstallPill');
      return {
        ua: navigator.userAgent,
        title: document.title,
        inApp: document.documentElement.classList.contains('aero-in-app'),
        voice: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        pillShown: !!(pill && pill.offsetParent),
        textLen: (document.body && document.body.innerText || '').trim().length,
        desktop: !!(window.RankerNodeDesktop && window.RankerNodeDesktop.isDesktopApp),
        hasPassword: !!document.querySelector('input[type=password]'),
        width: innerWidth, height: innerHeight
      };
    })()`);
    info('page title', page.title);
    info('user-agent', page.ua);
    /RankerNodeApp\/[\d.]+ \(Desktop; /.test(page.ua) ? pass('website sees the app (RankerNodeApp/… Desktop)') : fail('website sees the app (RankerNodeApp/… Desktop)', page.ua);
    !/Electron\//.test(page.ua) ? pass('clean user-agent (no Electron token)') : fail('clean user-agent (no Electron token)');
    page.inApp ? pass('"aero-in-app" mode on (Get App buttons hidden)') : fail('"aero-in-app" mode on (Get App buttons hidden)');
    !page.pillShown ? pass('no "Get App" button inside the app') : fail('no "Get App" button inside the app');
    !page.voice ? pass('voice typing hidden (needs Chrome)') : fail('voice typing hidden (needs Chrome)');
    page.desktop ? pass('desktop bridge present') : fail('desktop bridge present');
    page.textLen > 40 ? pass('page has content', page.textLen + ' characters, ' + page.width + '×' + page.height) : fail('page has content', page.textLen + ' characters');
    info('login form shown', String(page.hasPassword));
    await shot(wc, '01-app.png');

    /* 4. a download made by the website (same way notes export works) */
    const before = hooks.downloads.length;
    const TEXT = 'hello from the RankerNode desktop test';
    await wc.executeJavaScript(`(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([${JSON.stringify(TEXT)}], { type: 'text/plain' }));
      a.download = 'rankernode-selftest.txt';
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    })()`, true);
    const dl = await waitUntil(() => hooks.downloads[before], 20000);
    if (!dl) fail('download is saved', 'no download happened');
    else if (dl.state !== 'completed') fail('download is saved', dl.state);
    else {
      let body = '';
      try { body = fs.readFileSync(dl.path, 'utf8'); } catch (_) {}
      const inFolder = /[\\/]RankerNode[\\/]rankernode-selftest( \(\d+\))?\.txt$/.test(dl.path);
      body === TEXT && inFolder ? pass('download is saved', dl.path) : fail('download is saved', dl.path + ' · content ' + JSON.stringify(body.slice(0, 60)));
      try { fs.unlinkSync(dl.path); } catch (_) {}
    }

    /* 5. a pop-up the website opens (certificates use this) stays in the app */
    const kids = hooks.children.length;
    const opened = await wc.executeJavaScript(`(() => {
      const w = window.open('', '_blank');
      if (!w) return 'blocked';
      w.document.write('<title>RankerNode popup test</title><h1>Certificate preview test</h1>');
      w.document.close();
      return 'ok';
    })()`, true);
    const child = await waitUntil(() => hooks.children[kids], 8000);
    if (opened === 'ok' && child) {
      await sleep(800);
      const prot = typeof child.isContentProtected === 'function' ? child.isContentProtected() : true;
      prot ? pass('pop-up opens inside the app (protected)') : fail('pop-up opens inside the app (protected)', 'not protected');
      await shot(child.webContents, '02-popup.png');
      child.close();
    } else fail('pop-up opens inside the app', 'result ' + opened);

    /* 6. YouTube / other sites go to the normal browser */
    const ext0 = hooks.external.length;
    await wc.executeJavaScript(`window.open('https://www.youtube.com/watch?v=rankernode-test', '_blank'); true`, true);
    const ext = await waitUntil(() => hooks.external.slice(ext0).find((u) => /youtube\.com/.test(u)), 5000);
    ext ? pass('YouTube link opens in the browser') : fail('YouTube link opens in the browser');
    const kidsAfter = hooks.children.length;
    kidsAfter === kids + 1 ? pass('no extra app window for outside links') : fail('no extra app window for outside links', (kidsAfter - kids) + ' windows');

    const ext1 = hooks.external.length;
    const urlBefore = wc.getURL();
    await wc.executeJavaScript(`location.href = 'https://example.com/'; true`, true);
    const ext2 = await waitUntil(() => hooks.external.slice(ext1).find((u) => /example\.com/.test(u)), 5000);
    await sleep(1000);
    ext2 && /rankernode\.tech/.test(wc.getURL()) ? pass('outside sites do not replace the app page') : fail('outside sites do not replace the app page', 'now at ' + wc.getURL() + ' (was ' + urlBefore + ')');

    /* 7. deep links */
    const dl1 = deepLinkToUrl('rankernode://open/courses');
    const dl2 = deepLinkToUrl('rankernode://app#/notes');
    dl1 === 'https://rankernode.example/courses' && dl2 === 'https://rankernode.example/app#/notes'
      ? pass('rankernode:// links map to the site') : fail('rankernode:// links map to the site', dl1 + ' · ' + dl2);

    /* 8. offline screen */
    wc.loadURL('https://offline-check.invalid/').catch(() => {});
    const off = await waitUntil(() => /offline\.html/.test(wc.getURL()) && !wc.isLoading(), 20000);
    if (off) { pass('offline screen shows when the site cannot be reached'); await sleep(800); await shot(wc, '03-offline.png'); }
    else fail('offline screen shows when the site cannot be reached', 'now at ' + wc.getURL());

    /* 9. and back */
    wc.loadURL(appUrl).catch(() => {});
    const back = await waitUntil(() => /rankernode\.tech/.test(wc.getURL()) && !wc.isLoading(), 45000);
    back ? pass('reconnects to the site') : fail('reconnects to the site', wc.getURL());

    /* 10. zoom keeps working */
    wc.setZoomLevel(1); const z = wc.getZoomLevel(); wc.setZoomLevel(0);
    z === 1 ? pass('zoom works') : fail('zoom works', String(z));

    info('total test time', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  } catch (e) {
    fail('test ran without errors', e && (e.stack || e.message));
  }
  finish();
};
