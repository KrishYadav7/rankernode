/* ============================================================
   ⭐ LEARNING (2026-10-11)
   ------------------------------------------------------------
   Student  · Practice tab — Daily Challenge, My Mistakes (retry +
              AI explanation), Assignments, Test Series
            · Analytics — topic-wise strengths, rank & percentile per
              test, report card PDF
            · Home — today's challenge / assignments banner
   Instructor · Question Bank tab — search, add, edit, import CSV
              · Paper editor — save to bank, add from bank, auto paper
              · Grading — test series manager, report card
   Uses the app's globals (currentUser, fetchJSON, escapeHtml…).
   ============================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const $id = (id) => document.getElementById(id);
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const api = (path, opts) => fetchJSON(`${API_BASE}${path}`, Object.assign({ cache: 'no-store' }, opts || {}));
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const math = (el) => { try { if (el) renderMathIn(el); } catch (_) {} };
  const md = (t) => (typeof renderMarkdown === 'function' ? renderMarkdown(t) : esc(t).replace(/\n/g, '<br>'));
  const L = (i) => String.fromCharCode(65 + i);
  const RIGHT = ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
  const fmtDate = (d, time) => { try { return new Date(d).toLocaleString(undefined, time ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };
  const tone = (p) => p >= 75 ? 'ok' : p >= 40 ? 'mid' : 'bad';
  const isStudent = () => currentUser && !['admin', 'professor'].includes(String(currentUser.role || '').toLowerCase());

  /* ============================================================
     SUMMARY — nav dot + home banner
     ============================================================ */
  let _sumAt = 0;
  async function refreshSummary(force) {
    if (!isStudent()) return null;
    if (!force && Date.now() - _sumAt < 60000 && window._learnSummary) return window._learnSummary;
    _sumAt = Date.now();
    try {
      const d = await api(`/learn/summary?_t=${Date.now()}`);
      if (d && d.success) {
        const before = JSON.stringify(window._learnSummary || {});
        window._learnSummary = d;
        if (before !== JSON.stringify(d)) { try { buildNav(); } catch (_) {} }
        paintHomeBanner();
        return d;
      }
    } catch (_) {}
    return null;
  }
  window.refreshLearnSummary = refreshSummary;

  function paintHomeBanner() {
    const home = $id('studentHomeView');
    if (!home || !isStudent()) return;
    let box = $id('practiceBannerContainer');
    if (!box) {
      box = document.createElement('div');
      box.id = 'practiceBannerContainer';
      const after = $id('continueCardContainer') || $id('streakCardContainer');
      if (after && after.parentNode) after.parentNode.insertBefore(box, after.nextSibling); else home.prepend(box);
    }
    const s = window._learnSummary;
    if (!s) { box.innerHTML = ''; return; }
    const st = s.streak || {};
    box.innerHTML = `
      <div class="lp-banner">
        <div class="lp-banner-main">
          <div class="lp-banner-icon ${s.dailyDone ? 'done' : ''}"><i class="fas ${s.dailyDone ? 'fa-circle-check' : 'fa-bullseye'}"></i></div>
          <div>
            <b>${s.dailyDone ? 'Daily challenge done — see you tomorrow!' : "Today's 5-question challenge is ready"}</b>
            <span>${st.count ? `<i class="fas fa-fire"></i> ${st.count}-day practice streak` : 'Start a practice streak today'}${s.mistakes ? ` · ${s.mistakes} mistake${s.mistakes === 1 ? '' : 's'} to fix` : ''}${s.assignmentsDue ? ` · <b class="lp-due">${s.assignmentsDue} assignment${s.assignmentsDue === 1 ? '' : 's'} due</b>` : ''}</span>
          </div>
        </div>
        <div class="lp-banner-actions">
          ${s.assignmentsDue ? `<button class="btn btn-outline btn-sm" onclick="openPractice('assignments')"><i class="fas fa-book-open-reader"></i> Assignments</button>` : ''}
          <button class="btn ${s.dailyDone ? 'btn-outline' : 'btn-primary'} btn-sm" onclick="openPractice('${s.dailyDone && s.mistakes ? 'mistakes' : 'today'}')">${s.dailyDone ? (s.mistakes ? '<i class="fas fa-rotate"></i> Fix mistakes' : '<i class="fas fa-bullseye"></i> Practice') : '<i class="fas fa-play"></i> Start'}</button>
        </div>
      </div>`;
  }

  /* hook: home + login */
  if (typeof window.renderStudentHome === 'function') {
    const orig = window.renderStudentHome;
    window.renderStudentHome = function () {
      const r = orig.apply(this, arguments);
      paintHomeBanner();
      refreshSummary(false);
      return r;
    };
  }
  setTimeout(() => refreshSummary(true), 2500);

  /* ============================================================
     PRACTICE PAGE
     ============================================================ */
  const P = { tab: 'today', daily: null, mistakes: null, mFilter: { course: 'all', topic: 'all', status: 'all' }, assignments: null, series: null, open: {} };

  window.openPractice = function (tab) {
    if (tab) P.tab = tab;
    navigateStudent('practice');
  };

  /* ⭐ renderApp() runs often (sync events, streak, notifications…). The
     Practice page must not throw away what is on screen and show
     "Loading…" again every time — that made it flicker / oscillate.
     It rebuilds only when the tab changes or the data is old. */
  const PRACTICE_FRESH_MS = 120000;
  window.renderPractice = async function (force) {
    const host = $id('practiceContent');
    if (!host) return;
    const sub = (location.hash.split('/')[2] || '').trim();
    if (['today', 'mistakes', 'assignments', 'series'].includes(sub)) P.tab = sub;
    if (force !== true && P.shownTab === P.tab && $id('lpBody') && host.contains($id('lpBody')) &&
        Date.now() - (P.shownAt || 0) < PRACTICE_FRESH_MS) {
      paintPracticeHeader();              // counts only — the body stays as it is
      return;
    }
    P.shownTab = P.tab;
    P.shownAt = Date.now();
    const s = window._learnSummary || {};
    const st = s.streak || {};
    host.innerHTML = `
      <div class="lp-head">
        <div>
          <h2><i class="fas fa-bullseye"></i> Practice</h2>
          <p>Fix your mistakes, keep the streak alive, and stay on top of assignments.</p>
        </div>
        <div class="lp-streak ${st.count ? 'on' : ''}" title="Days in a row with the daily challenge finished">
          <i class="fas fa-fire"></i><b id="lpStreakN">${st.count || 0}</b><span>day streak${st.best ? ` · best ${st.best}` : ''}</span>
        </div>
      </div>
      <div class="lp-tabs" role="tablist">
        ${[['today', 'fa-bolt', 'Daily challenge', s.dailyDone ? '' : '•'], ['mistakes', 'fa-rotate', 'My mistakes', s.mistakes || ''],
           ['assignments', 'fa-book-open-reader', 'Assignments', s.assignmentsDue || ''], ['series', 'fa-trophy', 'Test series', '']]
          .map(([k, ic, l, b]) => `<button role="tab" class="lp-tab ${P.tab === k ? 'on' : ''}" onclick="lpTab('${k}')"><i class="fas ${ic}"></i><span>${l}</span>${b !== '' ? `<em>${b}</em>` : ''}</button>`).join('')}
      </div>
      <div id="lpBody" class="lp-body"><div class="gr-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>`;
    refreshSummary(false).then(paintPracticeHeader);
    await lpRenderTab();
  };
  /* streak + tab badges, without touching the body */
  function paintPracticeHeader() {
    const ss = window._learnSummary; if (!ss) return;
    const n = $id('lpStreakN'); if (n) n.textContent = (ss.streak || {}).count || 0;
    const badges = { today: ss.dailyDone ? '' : '•', mistakes: ss.mistakes || '', assignments: ss.assignmentsDue || '' };
    document.querySelectorAll('.lp-tab').forEach(t => {
      const k = (t.getAttribute('onclick') || '').match(/lpTab\('(\w+)'\)/);
      if (!k || !(k[1] in badges)) return;
      let em = t.querySelector('em');
      const v = badges[k[1]];
      if (v === '' && em) em.remove();
      else if (v !== '') { if (!em) { em = document.createElement('em'); t.appendChild(em); } em.textContent = v; }
    });
  }
  window.lpTab = function (k) {
    P.tab = k;
    try { history.replaceState(null, '', '#/practice/' + k); } catch (_) {}
    window.renderPractice(true);
  };
  /* one load per tab at a time; a slower, older answer never overwrites a newer one */
  let _lpSeq = 0;
  const _lpTicket = () => ++_lpSeq;
  const _lpCurrent = (t) => t === _lpSeq;
  async function lpRenderTab() {
    if (P.tab === 'mistakes') return renderMistakes();
    if (P.tab === 'assignments') return renderAssignments();
    if (P.tab === 'series') return renderSeries();
    return renderDaily();
  }

  /* ---------- shared: answer input + reveal ---------- */
  function answerInput(q, id, disabled, value) {
    const t = q.type || 'single';
    if (t === 'single' || t === 'multiple') {
      const chosen = Array.isArray(value) ? value.map(Number) : (value === null || value === undefined ? [] : [Number(value)]);
      return `<div class="lp-opts" data-type="${t}">${(q.options || []).map((o, i) => `
        <label class="lp-opt ${chosen.includes(i) ? 'sel' : ''}">
          <input type="${t === 'single' ? 'radio' : 'checkbox'}" name="${id}" value="${i}" ${chosen.includes(i) ? 'checked' : ''} ${disabled ? 'disabled' : ''}
                 onchange="this.closest('.lp-opts').querySelectorAll('.lp-opt').forEach(x=>x.classList.toggle('sel', x.querySelector('input').checked))">
          <span class="lp-opt-l">${L(i)}</span><span class="latex-content">${esc(o)}</span>
        </label>`).join('')}</div>`;
    }
    if (t === 'integer' || t === 'numerical') {
      return `<input class="lp-num" type="number" step="any" id="${id}" placeholder="Your answer" value="${value === null || value === undefined ? '' : esc(String(value))}" ${disabled ? 'disabled' : ''}>`;
    }
    if (t === 'matrix') {
      const picks = Array.isArray(value) ? value : [];
      return `<div class="lp-matrix">${(q.matrixLeftItems || []).map((it, li) => `
        <div class="lp-mrow"><span><b>${L(li)}.</b> <span class="latex-content">${esc(it)}</span></span>
          <select data-li="${li}" ${disabled ? 'disabled' : ''}><option value="">— match —</option>
            ${(q.matrixRightItems || []).map((r, ri) => `<option value="${ri}" ${Number(picks[li]) === ri && picks[li] !== null && picks[li] !== undefined ? 'selected' : ''}>${RIGHT[ri] || ri + 1}. ${esc(String(r).slice(0, 60))}</option>`).join('')}
          </select></div>`).join('')}</div>`;
    }
    return '';
  }
  function readAnswer(card, q, id) {
    const t = q.type || 'single';
    if (t === 'single') { const c = card.querySelector(`input[name="${id}"]:checked`); return c ? Number(c.value) : null; }
    if (t === 'multiple') return [...card.querySelectorAll(`input[name="${id}"]:checked`)].map(x => Number(x.value));
    if (t === 'integer' || t === 'numerical') { const v = (card.querySelector('.lp-num') || {}).value; return v === '' || v === undefined ? null : v; }
    if (t === 'matrix') return [...card.querySelectorAll('.lp-matrix select')].map(s => s.value === '' ? null : Number(s.value));
    return null;
  }
  function empty(q, a) {
    if (a === null || a === undefined || a === '') return true;
    if (Array.isArray(a)) return !a.filter(x => x !== null && x !== undefined && x !== '').length || ((q.type === 'matrix') && a.some(x => x === null));
    return false;
  }
  function keyHtml(q, answer) {
    const t = q.type || 'single';
    if (t === 'single' || t === 'multiple') {
      const chosen = Array.isArray(answer) ? answer.map(Number) : (answer === null || answer === undefined ? [] : [Number(answer)]);
      return `<div class="lp-opts done">${(q.options || []).map((o, i) => {
        const key = (q.correctIndexes || []).map(Number).includes(i), pick = chosen.includes(i);
        return `<div class="lp-opt ${key ? 'key' : ''} ${pick && !key ? 'wrong' : ''} ${pick && key ? 'right' : ''}">
          <span class="lp-opt-l">${key ? '<i class="fas fa-check"></i>' : pick ? '<i class="fas fa-xmark"></i>' : L(i)}</span><span class="latex-content">${esc(o)}</span>
          ${pick ? `<em>${key ? 'your answer ✓' : 'your answer'}</em>` : key ? '<em>correct</em>' : ''}</div>`;
      }).join('')}</div>`;
    }
    if (t === 'integer' || t === 'numerical') {
      const k = t === 'integer' ? `${q.integerAnswer}${q.integerTolerance ? ` (± ${q.integerTolerance})` : ''}` : `${q.rangeMin} to ${q.rangeMax}`;
      return `<div class="lp-numkey"><span>Your answer <b>${answer === null || answer === undefined || answer === '' ? '—' : esc(String(answer))}</b></span><span class="ok">Correct <b>${esc(k)}</b></span></div>`;
    }
    if (t === 'matrix') {
      const a = Array.isArray(answer) ? answer : [];
      return `<table class="gr-matrix"><tbody>${(q.matrixLeftItems || []).map((it, li) => {
        const ci = ((q.matrixRows || [])[li] || {}).correctIndex;
        const p = a[li]; const ok = p !== null && p !== undefined && Number(p) === Number(ci);
        const lab = (i) => i === null || i === undefined ? '—' : `${RIGHT[i] || i + 1}. ${esc(String((q.matrixRightItems || [])[i] || '').slice(0, 50))}`;
        return `<tr><td><b>${L(li)}.</b> <span class="latex-content">${esc(it)}</span></td><td class="${p === null || p === undefined ? '' : ok ? 'ok' : 'bad'}">${lab(p)}</td><td class="ok">${lab(ci)}</td></tr>`;
      }).join('')}</tbody></table>`;
    }
    return '';
  }

  /* ---------- DAILY CHALLENGE ---------- */
  async function renderDaily() {
    const body = $id('lpBody'); if (!body) return;
    const tk = _lpTicket();
    try {
      const d = await api(`/learn/daily?_t=${Date.now()}`);
      if (!_lpCurrent(tk)) return;
      if (!d || !d.success) throw new Error((d && d.message) || 'Could not load.');
      P.daily = d;
    } catch (e) { body.innerHTML = `<div class="gr-loading"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`; return; }
    paintDaily();
  }
  function paintDaily() {
    const body = $id('lpBody'); const d = P.daily; if (!body || !d) return;
    if (d.empty) {
      body.innerHTML = `<div class="lp-empty"><i class="fas fa-seedling"></i><h3>No practice questions yet</h3>
        <p>Your daily challenge is built from your instructors' practice questions and from tests you have finished. Take a test first, then come back tomorrow!</p>
        <button class="btn btn-primary" onclick="navigateStudent('courses')"><i class="fas fa-graduation-cap"></i> Browse courses</button></div>`;
      return;
    }
    const answered = d.items.filter(x => x.answered).length;
    const right = d.items.filter(x => x.correct).length;
    const done = answered >= d.items.length;
    body.innerHTML = `
      <div class="lp-progress">
        <div class="lp-progress-txt"><b>${answered} / ${d.items.length}</b> answered${answered ? ` · <span class="ok-t">${right} right</span>` : ''}</div>
        <div class="lp-dots">${d.items.map(x => `<span class="${x.answered ? (x.correct ? 'ok' : 'bad') : ''}"></span>`).join('')}</div>
      </div>
      ${done ? `<div class="lp-done"><i class="fas fa-trophy"></i><div><b>Challenge complete — ${right}/${d.items.length} right!</b>
        <span>${right === d.items.length ? 'Perfect score. ' : ''}Your streak is safe for today. New questions tomorrow.</span></div>
        <button class="btn btn-outline btn-sm" onclick="lpTab('mistakes')"><i class="fas fa-rotate"></i> My mistakes</button></div>` : ''}
      ${d.items.map(x => dailyCard(x)).join('')}`;
    math(body);
  }
  function dailyCard(x) {
    const id = 'lpd' + x.index;
    return `<article class="lp-card ${x.answered ? (x.correct ? 'is-right' : 'is-wrong') : ''}" id="lpCard${x.index}">
      <header><span class="qs-chip">Q${x.index + 1}</span><span class="qs-muted">${esc(x.source)}</span>
        ${x.q.topic ? `<span class="lp-tag"><i class="fas fa-tag"></i> ${esc(x.q.topic)}</span>` : ''}
        ${x.q.difficulty ? `<span class="qe-diff-chip qe-diff-${esc(x.q.difficulty)}">${esc(x.q.difficulty)}</span>` : ''}
        ${x.answered ? `<span class="lp-verdict ${x.correct ? 'ok' : 'bad'}">${x.correct ? '<i class="fas fa-check"></i> Correct' : '<i class="fas fa-xmark"></i> Not quite'}</span>` : ''}</header>
      <div class="lp-q latex-content">${esc(x.q.question)}</div>
      ${x.answered ? keyHtml(x.q, x.answer) : answerInput(x.q, id, false, null)}
      ${x.answered && x.q.explanation ? `<details class="gr-expl" open><summary>Explanation</summary><div class="latex-content">${esc(x.q.explanation)}</div></details>` : ''}
      <div class="lp-actions">
        ${x.answered ? `<button class="btn btn-outline btn-sm" onclick="lpExplain(this, ${esc(JSON.stringify(Object.assign({}, x.ref, { answer: x.answer })))})"><i class="fas fa-robot"></i> Explain with AI</button>`
          : `<button class="btn btn-primary btn-sm" onclick="lpDailyCheck(${x.index})"><i class="fas fa-check"></i> Check answer</button>`}
      </div>
      <div class="lp-ai" hidden></div>
    </article>`;
  }
  window.lpDailyCheck = async function (index) {
    const d = P.daily; if (!d) return;
    const x = d.items.find(i => i.index === index); if (!x) return;
    const card = $id('lpCard' + index);
    const answer = readAnswer(card, x.q, 'lpd' + index);
    if (empty(x.q, answer)) return showToast('Pick or type an answer first.', 'error');
    const btn = card.querySelector('.lp-actions .btn-primary'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking…'; }
    try {
      const r = await post('/learn/daily/answer', { index, answer });
      if (!r || !r.success) {
        if (r && r.code === 'STALE') return renderDaily();
        throw new Error((r && r.message) || 'Could not check.');
      }
      Object.assign(x, { answered: true, answer, correct: r.correct, q: r.q });
      if (r.finished) {
        showToast(`🔥 Challenge complete! ${r.streak && r.streak.count ? `${r.streak.count}-day streak` : ''}${r.xpResult && r.xpResult.gained ? ` · +${r.xpResult.gained} XP` : ''}`, 'success');
        refreshSummary(true).then(() => { const n = $id('lpStreakN'); if (n && window._learnSummary) n.textContent = (window._learnSummary.streak || {}).count || 0; });
      } else showToast(r.correct ? '✅ Correct!' : 'Not quite — see the correct answer.', r.correct ? 'success' : 'info');
      paintDaily();
      const c2 = $id('lpCard' + index); if (c2) c2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      showToast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Check answer'; }
    }
  };

  /* ---------- AI explanation (daily + mistakes) ---------- */
  window.lpExplain = async function (btn, ref) {
    const card = btn.closest('.lp-card');
    const box = card.querySelector('.lp-ai');
    box.hidden = false;
    box.innerHTML = `<div class="ai-loading"><div class="ai-spinner"></div><span>AI is working it out…</span></div>`;
    btn.disabled = true;
    try {
      const r = await post('/learn/explain', ref);
      if (!r || !r.success) throw new Error((r && r.message) || 'AI is not available right now.');
      box.innerHTML = `<div class="ai-answer-header"><i class="fas fa-robot"></i> <strong>AI explanation</strong><span class="ai-badge">${esc(r.model || 'AI')}</span></div>
        <div class="ai-answer-body">${md(r.explanation)}</div>
        <div class="ai-answer-footer"><span class="hint">⚠️ AI can make mistakes — the answer key above is what counts.</span></div>`;
      math(box);
      btn.innerHTML = '<i class="fas fa-robot"></i> Explained';
    } catch (e) {
      box.innerHTML = `<div class="ai-error"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`;
      btn.disabled = false;
    }
  };

  /* ---------- MY MISTAKES ---------- */
  async function renderMistakes() {
    const body = $id('lpBody'); if (!body) return;
    const tk = _lpTicket();
    try {
      const d = await api(`/learn/mistakes?_t=${Date.now()}`);
      if (!_lpCurrent(tk)) return;
      if (!d || !d.success) throw new Error((d && d.message) || 'Could not load.');
      P.mistakes = d;
    } catch (e) { body.innerHTML = `<div class="gr-loading"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`; return; }
    paintMistakes();
  }
  function paintMistakes() {
    const body = $id('lpBody'); const d = P.mistakes; if (!body || !d) return;
    if (!d.items.length) {
      body.innerHTML = `<div class="lp-empty"><i class="fas fa-circle-check"></i><h3>${d.masteredCount ? 'All mistakes fixed!' : 'No mistakes to fix'}</h3>
        <p>${d.masteredCount ? `You have fixed ${d.masteredCount} question${d.masteredCount === 1 ? '' : 's'} you once got wrong. ` : ''}Questions you get wrong or skip in tests show up here once results are published.</p></div>`;
      return;
    }
    const F = P.mFilter;
    const courses = [...new Map(d.items.map(i => [i.courseId, i.courseCode || i.courseName])).entries()];
    const topics = [...new Set(d.items.map(i => i.q.topic).filter(Boolean))].sort();
    const list = d.items.filter(i => (F.course === 'all' || i.courseId === F.course) && (F.topic === 'all' || i.q.topic === F.topic) && (F.status === 'all' || i.status === F.status));
    const byTopic = {};
    d.items.forEach(i => { const k = i.q.topic || 'Other'; byTopic[k] = (byTopic[k] || 0) + 1; });
    const top = Object.entries(byTopic).sort((a, b) => b[1] - a[1]).slice(0, 4);
    body.innerHTML = `
      <div class="lp-mhead">
        <div class="lp-mstat"><b>${d.total}</b><span>to fix</span></div>
        <div class="lp-mstat ok"><b>${d.masteredCount}</b><span>fixed</span></div>
        ${top.length ? `<div class="lp-mtopics"><span class="qs-muted">Most mistakes in</span>${top.map(([k, n]) => `<button class="lp-tag" onclick="lpMF('topic', ${esc(JSON.stringify(k === 'Other' ? 'all' : k))})">${esc(k)} <b>${n}</b></button>`).join('')}</div>` : ''}
      </div>
      <div class="gr-toolbar">
        <select onchange="lpMF('course', this.value)"><option value="all">All courses</option>${courses.map(([id, n]) => `<option value="${esc(id)}" ${F.course === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        ${topics.length ? `<select onchange="lpMF('topic', this.value)"><option value="all">All topics</option>${topics.map(t => `<option ${F.topic === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        <div class="qs-filters">${[['all', 'All'], ['wrong', 'Wrong'], ['skipped', 'Skipped']].map(([k, l]) => `<button class="qs-filter ${F.status === k ? 'on' : ''}" onclick="lpMF('status','${k}')">${l}</button>`).join('')}</div>
      </div>
      ${list.length ? list.slice(0, 60).map((m, n) => mistakeCard(m, n)).join('') : '<div class="qs-empty"><p>Nothing matches.</p></div>'}
      ${list.length > 60 ? `<p class="qs-muted" style="text-align:center">Showing 60 of ${list.length} — fix these and more appear.</p>` : ''}`;
    math(body);
  }
  window.lpMF = function (k, v) { P.mFilter[k] = v; paintMistakes(); };
  function mistakeCard(m, n) {
    const id = 'lpm' + n;
    const state = P.open[m.key];       // undefined | {retry:true} | {result}
    let inner;
    if (state && state.result) {
      inner = keyHtml(state.result.q, state.answer) +
        (state.result.q.explanation ? `<details class="gr-expl" open><summary>Explanation</summary><div class="latex-content">${esc(state.result.q.explanation)}</div></details>` : '');
    } else if (state && state.retry) {
      inner = answerInput(m.q, id, false, null);
    } else {
      inner = `<div class="lp-was"><span class="lp-verdict ${m.status === 'wrong' ? 'bad' : ''}">${m.status === 'wrong' ? '<i class="fas fa-xmark"></i> You answered wrong' : '<i class="fas fa-forward"></i> You skipped this'}</span>
        <span class="qs-muted">Try it again — the answer is hidden until you check.</span></div>`;
    }
    return `<article class="lp-card ${state && state.result ? (state.result.correct ? 'is-right' : 'is-wrong') : ''}" data-key="${esc(m.key)}" data-n="${n}">
      <header><span class="qs-chip">${esc(m.courseCode || m.courseName)}</span><span class="qs-muted">${esc(m.testTitle)} · Q${m.qi + 1}${m.at ? ' · ' + fmtDate(m.at) : ''}</span>
        ${m.q.topic ? `<span class="lp-tag"><i class="fas fa-tag"></i> ${esc(m.q.topic)}</span>` : ''}
        ${m.q.difficulty ? `<span class="qe-diff-chip qe-diff-${esc(m.q.difficulty)}">${esc(m.q.difficulty)}</span>` : ''}
        ${state && state.result ? `<span class="lp-verdict ${state.result.correct ? 'ok' : 'bad'}">${state.result.correct ? '<i class="fas fa-check"></i> Fixed!' : '<i class="fas fa-xmark"></i> Still wrong'}</span>` : ''}</header>
      <div class="lp-q latex-content">${esc(m.q.question)}</div>
      ${inner}
      <div class="lp-actions">
        ${!state ? `<button class="btn btn-primary btn-sm" onclick="lpRetry(${n})"><i class="fas fa-rotate-right"></i> Try again</button>
                    <button class="btn btn-outline btn-sm" onclick="lpReveal(${n})"><i class="fas fa-eye"></i> Show answer</button>` : ''}
        ${state && state.retry && !state.result ? `<button class="btn btn-primary btn-sm" onclick="lpMistakeCheck(${n})"><i class="fas fa-check"></i> Check</button>` : ''}
        ${state && state.result && !state.result.correct ? `<button class="btn btn-outline btn-sm" onclick="lpRetry(${n})"><i class="fas fa-rotate-right"></i> Try again</button>` : ''}
        ${state && state.result ? `<button class="btn btn-outline btn-sm" onclick="lpExplain(this, ${esc(JSON.stringify({ materialId: m.materialId, qi: m.qi, answer: state.answer === undefined ? m.yourAnswer : state.answer }))})"><i class="fas fa-robot"></i> Explain with AI</button>` : ''}
      </div>
      <div class="lp-ai" hidden></div>
    </article>`;
  }
  const _mByN = (n) => {
    const d = P.mistakes; const F = P.mFilter;
    const list = d.items.filter(i => (F.course === 'all' || i.courseId === F.course) && (F.topic === 'all' || i.q.topic === F.topic) && (F.status === 'all' || i.status === F.status));
    return list[n];
  };
  window.lpRetry = function (n) { const m = _mByN(n); if (!m) return; P.open[m.key] = { retry: true }; paintMistakes(); };
  window.lpReveal = function (n) {
    const m = _mByN(n); if (!m) return;
    P.open[m.key] = { result: { correct: false, q: m.q, revealed: true }, answer: m.yourAnswer };
    paintMistakes();
  };
  window.lpMistakeCheck = async function (n) {
    const m = _mByN(n); if (!m) return;
    const card = document.querySelector(`.lp-card[data-n="${n}"]`);
    const answer = readAnswer(card, m.q, 'lpm' + n);
    if (empty(m.q, answer)) return showToast('Pick or type an answer first.', 'error');
    try {
      const r = await post('/learn/mistakes/check', { materialId: m.materialId, qi: m.qi, answer });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not check.');
      P.open[m.key] = { result: r, answer };
      showToast(r.correct ? '✅ Fixed — it leaves your mistakes list.' : 'Still not right — look at the solution.', r.correct ? 'success' : 'info');
      paintMistakes();
      if (r.correct) refreshSummary(true);
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* ---------- ASSIGNMENTS ---------- */
  async function renderAssignments() {
    const body = $id('lpBody'); if (!body) return;
    let d;
    const tk = _lpTicket();
    try { d = await api(`/learn/assignments?_t=${Date.now()}`); if (!_lpCurrent(tk)) return; if (!d || !d.success) throw new Error((d && d.message) || 'Could not load.'); }
    catch (e) { body.innerHTML = `<div class="gr-loading"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`; return; }
    if (!d.items.length) {
      body.innerHTML = `<div class="lp-empty"><i class="fas fa-book-open-reader"></i><h3>No assignments</h3><p>When your instructors give homework, it shows up here with its due date.</p></div>`;
      return;
    }
    const label = { open: ['Open', ''], overdue: ['Overdue — late allowed', 'bad'], late: ['Submitted late', 'warn'], submitted: ['Submitted', 'ok'], graded: ['Graded', 'ok'], closed: ['Closed', ''] };
    const dueIn = (t) => {
      if (!t) return 'No deadline';
      const ms = new Date(t).getTime() - Date.now();
      if (ms <= 0) return `Was due ${fmtDate(t, true)}`;
      const h = Math.floor(ms / 3600e3), dd = Math.floor(h / 24);
      return `Due ${fmtDate(t, true)} · ${dd >= 1 ? `${dd}d ${h % 24}h left` : h >= 1 ? `${h}h left` : 'less than an hour left'}`;
    };
    body.innerHTML = `<div class="lp-assign-list">${d.items.map(a => {
      const [lab, cls] = label[a.status] || ['', ''];
      const urgent = a.status === 'open' && a.dueAt && new Date(a.dueAt).getTime() - Date.now() < 24 * 3600e3;
      const canOpen = a.status === 'open' || a.status === 'overdue';
      return `<article class="lp-assign ${urgent ? 'urgent' : ''}">
        <div class="lp-assign-ic"><i class="fas fa-book-open-reader"></i></div>
        <div class="lp-assign-main">
          <div class="lp-assign-top"><b>${esc(a.title)}</b><span class="qs-chip ${cls}">${lab}</span></div>
          <div class="qs-muted">${esc(a.courseCode ? a.courseCode + ' — ' : '')}${esc(a.courseName)} · ${a.questions} question${a.questions === 1 ? '' : 's'}</div>
          <div class="lp-assign-due ${urgent ? 'bad-t' : ''}"><i class="fas fa-clock"></i> ${dueIn(a.dueAt)}</div>
          ${a.score ? `<div class="lp-assign-score">Score <b>${a.score.earned} / ${a.score.possible}</b> (${a.score.pct}%)</div>` : a.pending && a.submittedAt ? '<div class="qs-muted"><i class="fas fa-hourglass-half"></i> Being graded</div>' : ''}
        </div>
        <div class="lp-assign-act">
          ${canOpen ? `<button class="btn btn-primary btn-sm" onclick="lpOpenAssignment('${a.courseId}','${a.materialId}')"><i class="fas fa-pen"></i> ${a.status === 'overdue' ? 'Submit late' : 'Start'}</button>` : ''}
          ${a.submittedAt ? `<button class="btn btn-outline btn-sm" onclick="openMyQuizResult('${a.courseId}','${a.materialId}')"><i class="fas fa-square-poll-vertical"></i> Result</button>` : ''}
        </div>
      </article>`;
    }).join('')}</div>`;
  }
  window.lpOpenAssignment = async function (courseId, materialId) {
    if (!findCourse(courseId)) { try { await fetchCoursesFromDB(true); } catch (_) {} }
    openQuizPlayer(courseId, materialId);
  };

  /* ---------- TEST SERIES ---------- */
  async function renderSeries() {
    const body = $id('lpBody'); if (!body) return;
    let d;
    const tk = _lpTicket();
    try { d = await api(`/learn/series?_t=${Date.now()}`); if (!_lpCurrent(tk)) return; if (!d || !d.success) throw new Error((d && d.message) || 'Could not load.'); }
    catch (e) { body.innerHTML = `<div class="gr-loading"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`; return; }
    if (!d.series.length) {
      body.innerHTML = `<div class="lp-empty"><i class="fas fa-trophy"></i><h3>No test series yet</h3><p>A test series ranks you across several tests together. Your instructors will add them here.</p></div>`;
      return;
    }
    body.innerHTML = d.series.map(s => {
      const done = s.tests.filter(t => t.done).length;
      return `<section class="lp-series">
        <header><div><h3><i class="fas fa-trophy"></i> ${esc(s.title)}</h3>${s.description ? `<p class="qs-muted">${esc(s.description)}</p>` : ''}</div>
          ${s.my ? `<div class="lp-series-me"><b>#${s.my.rank}</b><span>of ${s.participants}</span><em>${s.my.pct}%</em></div>` : `<div class="lp-series-me"><span>${s.participants} taking part</span></div>`}</header>
        <div class="lp-series-progress"><span class="gr-bar lg"><span class="gr-bar-fill ${tone(done / Math.max(1, s.tests.length) * 100)}" style="width:${done / Math.max(1, s.tests.length) * 100}%"></span></span>
          <span class="qs-muted">${done} of ${s.tests.length} tests done</span></div>
        <div class="lp-series-grid">
          <div class="lp-series-tests">${s.tests.map((t, i) => `
            <div class="lp-st ${t.done ? 'done' : ''}">
              <span class="lp-st-n">${t.done ? '<i class="fas fa-check"></i>' : i + 1}</span>
              <span class="lp-st-main"><b>${esc(t.title)}</b><span class="qs-muted">${esc(t.courseCode || t.courseName)} · ${t.questions} Q</span></span>
              ${t.done ? `<b class="${tone(t.pct || 0)}-t">${t.pct === null ? '—' : t.pct + '%'}</b>`
                : t.locked ? '<span class="qs-muted"><i class="fas fa-lock"></i></span>'
                : `<button class="btn btn-primary btn-sm" onclick="lpOpenAssignment('${t.courseId}','${t.materialId}')">Start</button>`}
            </div>`).join('')}</div>
          <div class="lp-series-board"><div class="myres-board-h"><i class="fas fa-ranking-star"></i> Leaderboard</div>
            ${s.top.length ? s.top.map(x => `<div class="myres-board-row ${x.me ? 'me' : ''}"><span class="myres-medal r${x.rank}">${x.rank}</span><span>${esc(x.name)}${x.me ? ' <em>(you)</em>' : ''}</span><b>${x.pct}%</b></div>`).join('') : '<p class="qs-muted">Nobody yet — be first!</p>'}
          </div>
        </div>
      </section>`;
    }).join('');
  }

  /* ============================================================
     ANALYTICS — performance block + report card
     ============================================================ */
  if (typeof window.renderStudentAnalytics === 'function') {
    const origA = window.renderStudentAnalytics;
    window.renderStudentAnalytics = async function () {
      const r = await origA.apply(this, arguments);
      paintPerformance();
      return r;
    };
  }
  async function paintPerformance() {
    const host = $id('analyticsContent');
    if (!host || !isStudent()) return;
    let box = $id('lpPerf');
    if (!box) { box = document.createElement('section'); box.id = 'lpPerf'; box.className = 'lp-perf'; host.prepend(box); }
    let d;
    /* re-renders of the Analytics page reuse the last answer for 2 min (no flicker) */
    if (P.perf && Date.now() - P.perf.at < 120000) d = P.perf.d;
    else {
      if (!box.innerHTML) box.innerHTML = `<div class="gr-loading"><i class="fas fa-spinner fa-spin"></i> Analysing your tests…</div>`;
      if (P.perfLoading) return;
      P.perfLoading = true;
      try { d = await api(`/learn/performance?_t=${Date.now()}`); if (!d || !d.success) throw new Error('x'); P.perf = { at: Date.now(), d }; }
      catch (_) { box.remove(); return; }
      finally { P.perfLoading = false; }
      box = $id('lpPerf') || box;
      if (!box.isConnected) { const h2 = $id('analyticsContent'); if (!h2) return; h2.prepend(box); }
    }
    const S = d.summary;
    const card = (cls, b, l) => `<div class="gr-kpi ${cls}"><b>${b}</b><span>${l}</span></div>`;
    const bar = (x) => `<div class="lp-topic"><span class="lp-topic-n" title="${esc(x.name)}">${esc(x.name)}</span>
      <span class="gr-bar lg"><span class="gr-bar-fill ${tone(x.pct)}" style="width:${x.pct}%"></span></span><b>${x.pct}%</b><span class="qs-muted">${x.right}/${x.total}</span></div>`;
    const diffOrder = { easy: 0, medium: 1, hard: 2 };
    box.innerHTML = `
      <div class="lp-perf-head">
        <h3><i class="fas fa-brain"></i> Test performance</h3>
        <button class="btn btn-outline btn-sm" onclick="downloadReportCard()"><i class="fas fa-file-pdf"></i> Report card (PDF)</button>
      </div>
      ${S.tests ? `
      <div class="gr-kpis lp-perf-kpis">
        ${card('', S.tests, 'tests graded')}
        ${card(tone(S.avgPct), S.avgPct + '%', 'average score')}
        ${card('ok', S.bestPct + '%', 'best score')}
        ${card('', S.avgPercentile === null ? '—' : S.avgPercentile, 'average percentile')}
      </div>
      ${d.weakTopics.length || d.strongTopics.length ? `<div class="lp-advice">
        ${d.weakTopics.length ? `<div class="lp-advice-row bad"><i class="fas fa-crosshairs"></i><div><b>Revise next:</b> <span>${d.weakTopics.map(t => `${esc(t.name)} <span class="qs-muted">(${t.pct}%)</span>`).join(', ')}</span>
          <button class="btn btn-outline btn-sm" onclick="openPractice('mistakes')">Practise these</button></div></div>` : ''}
        ${d.strongTopics.length ? `<div class="lp-advice-row ok"><i class="fas fa-medal"></i><div><b>Strong in:</b> <span>${d.strongTopics.map(t => `${esc(t.name)} <span class="qs-muted">(${t.pct}%)</span>`).join(', ')}</span></div></div>` : ''}
      </div>` : ''}
      <div class="gr-split lp-perf-split">
        <div class="gr-card"><div class="gr-card-head"><h3><i class="fas fa-tags"></i> By topic</h3></div>
          ${d.topics.length ? d.topics.slice().sort((a, b) => b.total - a.total).slice(0, 12).map(bar).join('') : '<p class="qs-muted">Topics appear when your instructors tag their questions.</p>'}
          ${d.difficulty.length ? `<div class="lp-diff">${d.difficulty.sort((a, b) => (diffOrder[a.name] ?? 9) - (diffOrder[b.name] ?? 9)).map(x => `<span class="qe-diff-chip qe-diff-${esc(x.name)}">${esc(x.name)} ${x.pct}%</span>`).join('')}</div>` : ''}
        </div>
        <div class="gr-card"><div class="gr-card-head"><h3><i class="fas fa-list-ol"></i> Rank in each test</h3></div>
          <div class="lp-ranks">${d.tests.slice().reverse().slice(0, 12).map(t => `
            <div class="lp-rank-row">
              <span class="lp-rank-main"><b>${esc(t.title)}</b><span class="qs-muted">${esc(t.courseCode || t.courseName)}${t.at ? ' · ' + fmtDate(t.at) : ''}${t.pending ? ' · being graded' : ''}</span></span>
              <span class="lp-rank-pct ${tone(t.pct)}-t">${t.pct}%</span>
              <span class="lp-rank-pos">${t.rank ? `#${t.rank}<small>/${t.of}</small>` : '—'}</span>
              <span class="lp-rank-pctl" title="Percentile — you did better than this % of the class">${t.percentile === null ? '' : `P${Math.round(t.percentile)}`}</span>
            </div>`).join('')}</div>
        </div>
      </div>` : `<p class="qs-muted">Your test results will show here — with your rank and topic-wise strengths — once a result is published.</p>`}`;
  }
  window.downloadReportCard = async function (userId) {
    try {
      showToast('Preparing your report card…', 'info');
      const url = `${API_BASE}/learn/report-card.pdf${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || 'Could not create the report card.'); }
      const blob = await res.blob();
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
      const fname = name ? name[1] : 'report-card.pdf';
      /* the Android app saves through its own bridge when present */
      if (window.__aeroSaveBlob) return window.__aeroSaveBlob(blob, fname);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* ============================================================
     PAPER EDITOR — question bank tools
     ============================================================ */
  function bankPayload(q) {
    const c = typeof _cleanQuestionForSave === 'function' ? _cleanQuestionForSave(q) : JSON.parse(JSON.stringify(q));
    return Object.assign(c, { courseId: quizEditingCourseId || '', practice: true });
  }
  window.saveQuestionToBank = async function (qi) {
    const q = quizDraft[qi]; if (!q) return;
    if (!String(q.question || '').trim()) return showToast('Write the question first.', 'error');
    try {
      const r = await post('/qbank', bankPayload(q));
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not save.');
      showToast(r.duplicate ? 'Already in the Question Bank.' : `✅ Q${qi + 1} saved to the Question Bank.`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  };
  window.saveAllQuestionsToBank = async function () {
    if (!quizDraft.length) return;
    const ok = await quizConfirm({ title: `Save ${quizDraft.length} questions to the bank?`, icon: 'fa-box-archive', ok: 'Save all',
      text: 'Questions already in the bank are skipped. Students also get them in their Daily Challenge practice (you can turn that off per question in the bank).' });
    if (!ok) return;
    try {
      const r = await post('/qbank/import', { courseId: quizEditingCourseId || '', items: quizDraft.map(q => bankPayload(q)) });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not save.');
      showToast(`✅ ${r.added} added${r.skipped ? `, ${r.skipped} already there` : ''}${r.errors && r.errors.length ? `, ${r.errors.length} incomplete skipped` : ''}.`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  };
  function addQuestionsToDraft(list) {
    const existing = new Set(quizDraft.map(q => String(q.question || '').trim()));
    let n = 0;
    list.forEach(q => {
      if (existing.has(String(q.question || '').trim())) return;
      quizDraft.push(normalizeQuestion(q)); n++;
    });
    renderQuizDraft();
    try { updateQuizTotals(); } catch (_) {}
    const hc = $id('quizHeaderCount'); if (hc) hc.textContent = quizDraft.length;
    return n;
  }

  /* Picker */
  const BP = { q: '', topic: '', difficulty: '', type: '', page: 1, sel: new Map(), data: null };
  window.openBankPicker = function () {
    BP.sel = new Map(); BP.page = 1;
    modal('bankPicker', `<div class="bk-head"><h3><i class="fas fa-box-archive"></i> Add from the Question Bank</h3>
        <button class="btn btn-outline btn-sm" onclick="closeLearnModal('bankPicker')"><i class="fas fa-xmark"></i></button></div>
      <div class="gr-toolbar">${bankFilters('bp')}</div>
      <div id="bpList" class="bk-list"></div>
      <div class="bk-foot"><span id="bpCount" class="qs-muted">Nothing selected</span>
        <span><button class="btn btn-outline btn-sm" onclick="closeLearnModal('bankPicker')">Cancel</button>
        <button class="btn btn-primary btn-sm" id="bpAdd" disabled onclick="bpAddSelected()"><i class="fas fa-plus"></i> Add to paper</button></span></div>`);
    loadPicker();
  };
  function bankFilters(prefix) {
    const S = prefix === 'bp' ? BP : QB;
    return `<div class="gr-search"><i class="fas fa-magnifying-glass"></i><input type="search" placeholder="Search questions…" value="${esc(S.q)}" oninput="${prefix}Set('q', this.value, true)"></div>
      <input type="text" list="qeTopicList" placeholder="Topic" value="${esc(S.topic)}" onchange="${prefix}Set('topic', this.value.trim())" class="bk-topic">
      <select onchange="${prefix}Set('difficulty', this.value)"><option value="">Any difficulty</option>${['easy', 'medium', 'hard'].map(d => `<option value="${d}" ${S.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <select onchange="${prefix}Set('type', this.value)"><option value="">Any type</option>${[['single', 'Single'], ['multiple', 'Multiple'], ['integer', 'Integer'], ['numerical', 'Numerical'], ['matrix', 'Matrix'], ['subjective', 'Subjective']].map(([k, l]) => `<option value="${k}" ${S.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  let _bpDeb = null;
  window.bpSet = function (k, v, debounce) {
    BP[k] = v; BP.page = 1;
    clearTimeout(_bpDeb);
    _bpDeb = setTimeout(loadPicker, debounce ? 250 : 0);
  };
  function qs(S) {
    const p = new URLSearchParams();
    ['q', 'topic', 'difficulty', 'type'].forEach(k => { if (S[k]) p.set(k, S[k]); });
    if (S.courseId) p.set('courseId', S.courseId);
    p.set('page', S.page || 1); p.set('_t', Date.now());
    return p.toString();
  }
  async function loadPicker() {
    const box = $id('bpList'); if (!box) return;
    box.innerHTML = '<div class="gr-loading"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
      const d = await api(`/qbank?${qs(BP)}`);
      if (!d || !d.success) throw new Error((d && d.message) || 'Could not load.');
      BP.data = d;
      const inPaper = new Set(quizDraft.map(q => String(q.question || '').trim()));
      box.innerHTML = d.items.length ? d.items.map(it => {
        const there = inPaper.has(String(it.question || '').trim());
        return `<label class="bk-item ${there ? 'there' : ''}">
          <input type="checkbox" ${BP.sel.has(it.id) ? 'checked' : ''} ${there ? 'disabled' : ''} onchange="bpToggle('${it.id}', this.checked)">
          <span class="bk-item-main"><span class="latex-content">${esc(String(it.question).slice(0, 260))}</span>
            <span class="bk-meta"><span class="mat-type">${esc(it.type)}</span>${it.topic ? `<span class="lp-tag"><i class="fas fa-tag"></i> ${esc(it.topic)}</span>` : ''}${it.difficulty ? `<span class="qe-diff-chip qe-diff-${esc(it.difficulty)}">${esc(it.difficulty)}</span>` : ''}<span class="qs-muted">+${it.marks}${it.negativeMarks ? ' / ' + it.negativeMarks : ''}${it.usedCount ? ` · used ${it.usedCount}×` : ''}</span>${there ? '<span class="qs-chip ok">in this paper</span>' : ''}</span></span>
        </label>`;
      }).join('') + pager(d, 'bpPage') : `<div class="qs-empty"><i class="fas fa-box-open"></i><p>No questions found. Save questions to the bank with the <i class="fas fa-box-archive"></i> button on any question.</p></div>`;
      math(box);
    } catch (e) { box.innerHTML = `<div class="gr-loading">${esc(e.message)}</div>`; }
  }
  function pager(d, fn) {
    if (d.pages <= 1) return `<div class="bk-pager qs-muted">${d.total} question${d.total === 1 ? '' : 's'}</div>`;
    return `<div class="bk-pager"><button class="btn btn-outline btn-sm" ${d.page <= 1 ? 'disabled' : ''} onclick="${fn}(${d.page - 1})"><i class="fas fa-chevron-left"></i></button>
      <span class="qs-muted">Page ${d.page} of ${d.pages} · ${d.total} questions</span>
      <button class="btn btn-outline btn-sm" ${d.page >= d.pages ? 'disabled' : ''} onclick="${fn}(${d.page + 1})"><i class="fas fa-chevron-right"></i></button></div>`;
  }
  window.bpPage = function (p) { BP.page = p; loadPicker(); };
  window.bpToggle = function (id, on) {
    if (on) BP.sel.set(id, true); else BP.sel.delete(id);
    const c = $id('bpCount'), b = $id('bpAdd');
    if (c) c.textContent = BP.sel.size ? `${BP.sel.size} selected` : 'Nothing selected';
    if (b) b.disabled = !BP.sel.size;
  };
  window.bpAddSelected = async function () {
    try {
      const r = await post('/qbank/pick', { ids: [...BP.sel.keys()] });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not add.');
      const n = addQuestionsToDraft(r.questions);
      closeLearnModal('bankPicker');
      showToast(`✅ ${n} question${n === 1 ? '' : 's'} added — remember to Save Paper.`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* Auto paper */
  window.openAutoPaper = async function () {
    let topics = [];
    try { const t = await api(`/qbank/topics?_t=${Date.now()}`); if (t && t.success) topics = t.topics; } catch (_) {}
    const total = topics.reduce((s, t) => s + t.count, 0);
    modal('autoPaper', `<div class="bk-head"><h3><i class="fas fa-wand-magic-sparkles"></i> Auto-generate a paper</h3>
        <button class="btn btn-outline btn-sm" onclick="closeLearnModal('autoPaper')"><i class="fas fa-xmark"></i></button></div>
      ${total ? `<p class="qs-muted">Picks random questions from the bank (${total} available). Questions already in this paper are skipped.</p>
      <div class="editor-grid-2">
        <div class="form-group"><label>How many questions</label><input type="number" id="apCount" min="1" max="100" value="10"></div>
        <div class="form-group"><label>Question types</label>
          <select id="apTypes"><option value="">Any</option><option value="auto">Auto-graded only</option><option value="single">Single correct only</option><option value="multiple">Multiple correct only</option><option value="integer,numerical">Numeric only</option></select></div>
      </div>
      <div class="form-group"><label>Difficulty mix <span class="qs-muted">(percent)</span></label>
        <div class="ap-mix">
          <label>Easy <input type="number" id="apEasy" min="0" max="100" value="30"></label>
          <label>Medium <input type="number" id="apMedium" min="0" max="100" value="50"></label>
          <label>Hard <input type="number" id="apHard" min="0" max="100" value="20"></label>
        </div></div>
      <div class="form-group"><label>Topics <span class="qs-muted">(none ticked = all)</span></label>
        <div class="ap-topics">${topics.map(t => `<label class="ap-topic"><input type="checkbox" value="${esc(t.topic)}"><span>${esc(t.topic || 'No topic')}</span><em>${t.count}</em></label>`).join('')}</div></div>
      <div class="bk-foot"><span></span><span><button class="btn btn-outline btn-sm" onclick="closeLearnModal('autoPaper')">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="apGenerate()"><i class="fas fa-wand-magic-sparkles"></i> Generate</button></span></div>`
      : `<div class="qs-empty"><i class="fas fa-box-open"></i><p>The Question Bank is empty. Save some questions to it first (<i class="fas fa-box-archive"></i> on any question, or "Save all to bank").</p></div>`}`);
  };
  window.apGenerate = async function () {
    const typeSel = ($id('apTypes') || {}).value || '';
    const types = typeSel === 'auto' ? ['single', 'multiple', 'integer', 'numerical', 'matrix'] : typeSel ? typeSel.split(',') : [];
    const body = {
      count: Number(($id('apCount') || {}).value) || 10, types,
      mix: { easy: Number(($id('apEasy') || {}).value) || 0, medium: Number(($id('apMedium') || {}).value) || 0, hard: Number(($id('apHard') || {}).value) || 0 },
      topics: [...document.querySelectorAll('.ap-topic input:checked')].map(i => i.value),
      courseId: quizEditingCourseId || '',
      excludeQuestions: quizDraft.map(q => String(q.question || '').trim()).filter(Boolean)
    };
    try {
      const r = await post('/qbank/pick', body);
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not generate.');
      if (!r.found) return showToast('No questions match these settings.', 'info');
      const n = addQuestionsToDraft(r.questions);
      closeLearnModal('autoPaper');
      showToast(`✨ ${n} question${n === 1 ? '' : 's'} added${n < body.count ? ` (only ${n} matched)` : ''} — review them, then Save Paper.`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* small modal helper */
  function modal(id, html) {
    closeLearnModal(id);
    const ov = document.createElement('div');
    ov.className = 'bk-ov'; ov.id = 'lm-' + id;
    ov.innerHTML = `<div class="bk-modal" role="dialog" aria-modal="true">${html}</div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeLearnModal(id); });
    document.body.appendChild(ov);
    document.body.classList.add('quiz-subs-open');
    math(ov);
    return ov;
  }
  window.closeLearnModal = function (id) {
    const ov = $id('lm-' + id); if (ov) ov.remove();
    if (!document.querySelector('.bk-ov') && !document.getElementById('quizSubsOverlay') && !document.getElementById('grOverlay')) document.body.classList.remove('quiz-subs-open');
  };

  /* ============================================================
     ADMIN — QUESTION BANK TAB
     ============================================================ */
  const QB = { q: '', topic: '', difficulty: '', type: '', courseId: '', page: 1, data: null, topics: null };
  (function ensureQBankTab() {
    const tabsEl = document.querySelector('.admin-tabs');
    if (!tabsEl || tabsEl.querySelector('[data-tab="qbank"]')) return;
    const btn = document.createElement('button');
    btn.className = 'admin-tab'; btn.dataset.tab = 'qbank';
    btn.setAttribute('onclick', "switchAdminTab('qbank')");
    btn.innerHTML = '<i class="fas fa-box-archive"></i> Question Bank';
    const anchor = tabsEl.querySelector('[data-tab="grading"]') || tabsEl.querySelector('[data-tab="students"]');
    if (anchor && anchor.nextSibling) anchor.parentNode.insertBefore(btn, anchor.nextSibling); else tabsEl.appendChild(btn);
    if (!$id('adminTabQbank')) {
      const c = document.createElement('div');
      c.className = 'admin-tab-content'; c.id = 'adminTabQbank';
      c.innerHTML = '<div id="adminQBankContent" class="gr-root"></div>';
      const view = $id('adminView'); if (view) view.appendChild(c);
    }
  })();
  const _qbOrigUI = window.updateAdminTabUI;
  window.updateAdminTabUI = function () {
    if (typeof _qbOrigUI === 'function') _qbOrigUI.apply(this, arguments);
    if (typeof adminTab !== 'undefined' && adminTab === 'qbank') {
      const t = $id('adminPageTitle'); if (t) t.innerHTML = '<i class="fas fa-box-archive"></i> Question Bank';
      const a = $id('adminHeaderActions');
      if (a) a.innerHTML = `<button class="btn btn-outline" onclick="qbImport()"><i class="fas fa-file-import"></i> <span class="btn-text">Import CSV</span></button>
        <button class="btn btn-success" onclick="qbEdit()"><i class="fas fa-plus-circle"></i> <span class="btn-text">New question</span></button>`;
    }
  };
  const _qbOrigRender = window.renderAdminDashboard;
  window.renderAdminDashboard = function () {
    if (typeof adminTab !== 'undefined' && adminTab === 'qbank') { try { updateAdminTabUI(); } catch (e) {} return renderQBank(); }
    if (typeof _qbOrigRender === 'function') return _qbOrigRender.apply(this, arguments);
  };
  let _qbDeb = null;
  window.qbSet = function (k, v, debounce) {
    QB[k] = v; QB.page = 1;
    clearTimeout(_qbDeb);
    _qbDeb = setTimeout(() => { QB._refocus = k === 'q'; renderQBank(); }, debounce ? 250 : 0);
  };
  window.qbPage = function (p) { QB.page = p; renderQBank(); };
  async function renderQBank() {
    const host = $id('adminQBankContent'); if (!host) return;
    if (!QB.data) host.innerHTML = '<div class="gr-loading"><i class="fas fa-spinner fa-spin"></i> Loading the bank…</div>';
    try {
      const [d, t] = await Promise.all([api(`/qbank?${qs(QB)}`), QB.topics ? Promise.resolve(QB.topics) : api(`/qbank/topics?_t=${Date.now()}`)]);
      if (!d || !d.success) throw new Error((d && d.message) || 'Could not load.');
      QB.data = d; if (t && t.success) QB.topics = t;
    } catch (e) { host.innerHTML = `<div class="gr-loading"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`; return; }
    const d = QB.data, T = QB.topics || { topics: [], total: 0 };
    const courses = (typeof liveCourses !== 'undefined' ? liveCourses : []) || [];
    let dl = $id('qeTopicList');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'qeTopicList'; document.body.appendChild(dl); }
    dl.innerHTML = T.topics.map(x => x.topic).filter(Boolean).map(x => `<option value="${esc(x)}"></option>`).join('');
    host.innerHTML = `
      <div class="gr-kpis">
        <div class="gr-kpi"><i class="fas fa-box-archive"></i><b>${T.total}</b><span>questions</span></div>
        <div class="gr-kpi"><i class="fas fa-tags"></i><b>${T.topics.filter(x => x.topic).length}</b><span>topics</span></div>
        <div class="gr-kpi ok"><b>${T.topics.reduce((s, x) => s + x.easy, 0)}</b><span>easy</span></div>
        <div class="gr-kpi warn"><b>${T.topics.reduce((s, x) => s + x.medium, 0)}</b><span>medium</span></div>
        <div class="gr-kpi bad"><b>${T.topics.reduce((s, x) => s + x.hard, 0)}</b><span>hard</span></div>
      </div>
      ${T.topics.filter(x => x.topic).length ? `<div class="qb-topics">${T.topics.filter(x => x.topic).map(x => `<button class="lp-tag ${QB.topic === x.topic ? 'on' : ''}" onclick="qbSet('topic', ${esc(JSON.stringify(QB.topic === x.topic ? '' : x.topic))})">${esc(x.topic)} <b>${x.count}</b></button>`).join('')}</div>` : ''}
      <section class="gr-card">
        <div class="gr-toolbar">${bankFilters('qb')}
          <select onchange="qbSet('courseId', this.value)"><option value="">All courses</option><option value="none" ${QB.courseId === 'none' ? 'selected' : ''}>Not linked to a course</option>
            ${courses.map(c => `<option value="${esc(c.id)}" ${QB.courseId === c.id ? 'selected' : ''}>${esc((c.code ? c.code + ' — ' : '') + c.name)}</option>`).join('')}</select>
        </div>
        <div class="bk-list">${d.items.length ? d.items.map(it => `
          <div class="bk-item qb-row">
            <span class="bk-item-main"><span class="latex-content">${esc(String(it.question).slice(0, 320))}</span>
              <span class="bk-meta"><span class="mat-type">${esc(it.type)}</span>${it.topic ? `<span class="lp-tag"><i class="fas fa-tag"></i> ${esc(it.topic)}</span>` : ''}${it.difficulty ? `<span class="qe-diff-chip qe-diff-${esc(it.difficulty)}">${esc(it.difficulty)}</span>` : ''}
                <span class="qs-muted">+${it.marks}${it.negativeMarks ? ' / ' + it.negativeMarks : ''}${it.usedCount ? ` · used ${it.usedCount}×` : ''}${it.createdBy && it.createdBy.name ? ` · by ${esc(it.createdBy.name)}` : ''}</span>
                ${it.practice ? '<span class="qs-chip ok" title="Offered in the students\' Daily Challenge"><i class="fas fa-bullseye"></i> practice</span>' : ''}</span></span>
            ${it.canEdit ? `<span class="qb-acts"><button class="quiz-icon-btn" title="Edit" onclick="qbEdit('${it.id}')"><i class="fas fa-pen"></i></button>
              <button class="quiz-icon-btn danger" title="Delete" onclick="qbDelete('${it.id}')"><i class="fas fa-trash-alt"></i></button></span>` : ''}
          </div>`).join('') + pager(d, 'qbPage')
          : `<div class="qs-empty"><i class="fas fa-box-open"></i><p>${T.total ? 'No question matches.' : 'The bank is empty. Add a question, import a CSV, or use <b>Save all to bank</b> in any paper editor.'}</p></div>`}</div>
      </section>`;
    math(host);
    if (QB._refocus) { const i = host.querySelector('.gr-search input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } QB._refocus = false; }
  }
  window.qbDelete = async function (id) {
    if (!(await quizConfirm({ title: 'Delete this question?', icon: 'fa-trash', danger: true, ok: 'Delete', text: 'It is removed from the bank. Papers that already use it keep their copy.' }))) return;
    try {
      const r = await api(`/qbank/${id}`, { method: 'DELETE' });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not delete.');
      QB.topics = null; showToast('Deleted.', 'success'); renderQBank();
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* add / edit form (all auto-graded types + subjective) */
  window.qbEdit = function (id) {
    const it = id && QB.data ? QB.data.items.find(x => x.id === id) : null;
    const q = it ? JSON.parse(JSON.stringify(it)) : { type: 'single', question: '', options: ['', '', '', ''], correctIndexes: [], marks: 4, negativeMarks: -1, topic: QB.topic || '', difficulty: '', practice: true, courseId: '' };
    window._qbForm = q;
    const courses = (typeof liveCourses !== 'undefined' ? liveCourses : []) || [];
    modal('qbEdit', `<div class="bk-head"><h3><i class="fas fa-${it ? 'pen' : 'plus'}"></i> ${it ? 'Edit question' : 'New question'}</h3>
        <button class="btn btn-outline btn-sm" onclick="closeLearnModal('qbEdit')"><i class="fas fa-xmark"></i></button></div>
      <div class="editor-grid-3">
        <div class="form-group"><label>Type</label><select id="qbType" onchange="qbTypeChange(this.value)">
          ${[['single', 'Single correct'], ['multiple', 'Multiple correct'], ['integer', 'Integer'], ['numerical', 'Numerical range'], ['subjective', 'Subjective (upload)']].map(([k, l]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="form-group"><label>Marks (+)</label><input type="number" id="qbMarks" step="0.5" min="0" value="${q.marks}"></div>
        <div class="form-group"><label>Negative (−)</label><input type="number" id="qbNeg" step="0.5" max="0" value="${q.negativeMarks}"></div>
      </div>
      <div class="editor-grid-3">
        <div class="form-group"><label>Topic</label><input type="text" id="qbTopic" list="qeTopicList" maxlength="80" value="${esc(q.topic || '')}"></div>
        <div class="form-group"><label>Difficulty</label><select id="qbDiff"><option value="">— Not set —</option>${['easy', 'medium', 'hard'].map(d => `<option value="${d}" ${q.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="form-group"><label>Course</label><select id="qbCourse"><option value="">Any course</option>${courses.map(c => `<option value="${esc(c.id)}" ${q.courseId === c.id ? 'selected' : ''}>${esc(c.code || c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label>Question <span class="hint" style="display:inline;">· LaTeX supported</span></label>
        <textarea id="qbQuestion" rows="3" class="latex-source">${esc(q.question || '')}</textarea></div>
      <div id="qbAnswer"></div>
      <div class="form-group"><label>Explanation (optional)</label><textarea id="qbExpl" rows="2" class="latex-source">${esc(q.explanation || '')}</textarea></div>
      <label class="qe-check"><input type="checkbox" id="qbPractice" ${q.practice !== false ? 'checked' : ''}><span>Use in students' Daily Challenge</span></label>
      <div class="bk-foot"><span></span><span><button class="btn btn-outline btn-sm" onclick="closeLearnModal('qbEdit')">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="qbSave('${it ? it.id : ''}')"><i class="fas fa-check"></i> Save</button></span></div>`);
    qbAnswerArea();
  };
  window.qbTypeChange = function (t) {
    const q = window._qbForm; q.type = t;
    if ((t === 'single' || t === 'multiple') && !(q.options || []).length) q.options = ['', '', '', ''];
    if (t === 'single') q.correctIndexes = (q.correctIndexes || []).slice(0, 1);
    qbAnswerArea();
  };
  function qbAnswerArea() {
    const q = window._qbForm, box = $id('qbAnswer'); if (!box) return;
    const t = q.type;
    if (t === 'single' || t === 'multiple') {
      box.innerHTML = `<div class="form-group"><label>Options <span class="qs-muted">— tick the correct one${t === 'multiple' ? 's' : ''}</span></label>
        ${(q.options || []).map((o, i) => `<div class="qb-opt"><input type="${t === 'single' ? 'radio' : 'checkbox'}" name="qbKey" ${(q.correctIndexes || []).includes(i) ? 'checked' : ''} onchange="qbKey(${i}, this.checked)">
          <span class="lp-opt-l">${L(i)}</span><input type="text" value="${esc(o)}" oninput="window._qbForm.options[${i}] = this.value" placeholder="Option ${L(i)}">
          ${(q.options || []).length > 2 ? `<button type="button" class="quiz-icon-btn danger" onclick="qbOpt(-1, ${i})"><i class="fas fa-xmark"></i></button>` : ''}</div>`).join('')}
        ${(q.options || []).length < 8 ? `<button type="button" class="btn btn-outline btn-sm" onclick="qbOpt(1)"><i class="fas fa-plus"></i> Option</button>` : ''}</div>`;
    } else if (t === 'integer') {
      box.innerHTML = `<div class="editor-grid-2"><div class="form-group"><label>Correct answer</label><input type="number" step="any" value="${q.integerAnswer ?? ''}" oninput="window._qbForm.integerAnswer = this.value"></div>
        <div class="form-group"><label>Tolerance ±</label><input type="number" step="any" min="0" value="${q.integerTolerance || 0}" oninput="window._qbForm.integerTolerance = this.value"></div></div>`;
    } else if (t === 'numerical') {
      box.innerHTML = `<div class="editor-grid-2"><div class="form-group"><label>Minimum accepted</label><input type="number" step="any" value="${q.rangeMin ?? ''}" oninput="window._qbForm.rangeMin = this.value"></div>
        <div class="form-group"><label>Maximum accepted</label><input type="number" step="any" value="${q.rangeMax ?? ''}" oninput="window._qbForm.rangeMax = this.value"></div></div>`;
    } else {
      box.innerHTML = `<div class="editor-grid-2"><div class="form-group"><label>Maximum marks</label><input type="number" min="1" value="${q.subjectiveMaxMarks || 10}" oninput="window._qbForm.subjectiveMaxMarks = this.value"></div>
        <div class="form-group"><label>Instructions</label><input type="text" value="${esc(q.subjectiveInstructions || '')}" oninput="window._qbForm.subjectiveInstructions = this.value"></div></div>`;
    }
  }
  window.qbKey = function (i, on) {
    const q = window._qbForm;
    if (q.type === 'single') q.correctIndexes = [i];
    else { const s = new Set(q.correctIndexes || []); on ? s.add(i) : s.delete(i); q.correctIndexes = [...s].sort(); }
  };
  window.qbOpt = function (dir, i) {
    const q = window._qbForm;
    if (dir > 0) q.options.push('');
    else { q.options.splice(i, 1); q.correctIndexes = (q.correctIndexes || []).filter(x => x !== i).map(x => x > i ? x - 1 : x); }
    qbAnswerArea();
  };
  window.qbSave = async function (id) {
    const q = window._qbForm;
    const body = Object.assign({}, q, {
      type: $id('qbType').value, question: $id('qbQuestion').value, explanation: $id('qbExpl').value,
      marks: $id('qbMarks').value, negativeMarks: $id('qbNeg').value, topic: $id('qbTopic').value.trim(),
      difficulty: $id('qbDiff').value, courseId: $id('qbCourse').value, practice: $id('qbPractice').checked
    });
    if (body.type === 'single' || body.type === 'multiple') {
      const keep = [], map = {};
      (body.options || []).forEach((o, i) => { if (String(o || '').trim()) { map[i] = keep.length; keep.push(o); } });
      body.correctIndexes = (body.correctIndexes || []).filter(i => map[i] !== undefined).map(i => map[i]);
      body.options = keep;
    }
    ['_id', 'id', 'canEdit', 'createdBy', 'createdAt', 'updatedAt', 'usedCount', '__v'].forEach(k => delete body[k]);
    try {
      const r = id ? await api(`/qbank/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) : await post('/qbank', body);
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not save.');
      closeLearnModal('qbEdit'); QB.topics = null;
      showToast(r.duplicate ? 'That question is already in the bank.' : '✅ Saved.', 'success');
      renderQBank();
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* CSV import: question,type,option A..F,correct,answer/min,max,marks,negative,topic,difficulty,explanation */
  window.qbImport = function () {
    modal('qbImport', `<div class="bk-head"><h3><i class="fas fa-file-import"></i> Import questions (CSV)</h3>
        <button class="btn btn-outline btn-sm" onclick="closeLearnModal('qbImport')"><i class="fas fa-xmark"></i></button></div>
      <p class="qs-muted">One question per row. The first row must be a header with these columns (any order; extra columns are ignored):</p>
      <pre class="qb-csv-help">question, type, a, b, c, d, e, f, correct, min, max, marks, negative, topic, difficulty, explanation</pre>
      <ul class="qb-csv-notes">
        <li><b>type</b>: single, multiple, integer or numerical (default single)</li>
        <li><b>correct</b>: letters for MCQ (<code>B</code> or <code>A;C</code>), the number for integer</li>
        <li><b>min / max</b>: the accepted range for numerical</li>
        <li>Save from Excel / Google Sheets as <b>CSV UTF-8</b>. LaTeX works.</li>
      </ul>
      <div class="qb-drop"><input type="file" accept=".csv,text/csv" id="qbCsv" onchange="qbCsvRead(this)"><span><i class="fas fa-upload"></i> Choose a CSV file</span></div>
      <a href="#" class="qb-sample" onclick="event.preventDefault();qbSampleCsv()"><i class="fas fa-download"></i> Download a sample CSV</a>
      <div id="qbCsvPreview"></div>`);
  };
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim()));
  }
  function csvToItems(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    if (rows.length < 2) return { items: [], error: 'The file needs a header row and at least one question.' };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = (r, ...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && r[i] !== undefined) return String(r[i]).trim(); } return ''; };
    if (head.indexOf('question') < 0) return { items: [], error: 'No "question" column in the header.' };
    const items = rows.slice(1).map(r => {
      const type = (col(r, 'type') || 'single').toLowerCase();
      const opts = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => col(r, k, 'option ' + k, 'option_' + k)).filter(Boolean);
      const correct = col(r, 'correct', 'answer');
      const it = { question: col(r, 'question'), type, topic: col(r, 'topic'), difficulty: col(r, 'difficulty').toLowerCase(), explanation: col(r, 'explanation'),
        marks: col(r, 'marks') || 4, negativeMarks: col(r, 'negative', 'negative marks') || (type === 'numerical' ? 0 : -1) };
      if (type === 'single' || type === 'multiple') {
        it.options = opts;
        it.correctIndexes = correct.toUpperCase().split(/[;|\s,]+/).filter(Boolean).map(x => x.charCodeAt(0) - 65).filter(i => i >= 0 && i < opts.length);
      } else if (type === 'integer') { it.integerAnswer = correct; }
      else if (type === 'numerical') { it.rangeMin = col(r, 'min'); it.rangeMax = col(r, 'max'); }
      if (it.negativeMarks > 0) it.negativeMarks = -it.negativeMarks;
      return it;
    });
    return { items };
  }
  window.qbCsvRead = function (input) {
    const f = input.files && input.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      const { items, error } = csvToItems(String(fr.result || ''));
      const box = $id('qbCsvPreview');
      if (error) { box.innerHTML = `<div class="ai-error">${esc(error)}</div>`; return; }
      window._qbImportItems = items;
      box.innerHTML = `<div class="qb-preview"><b>${items.length} question${items.length === 1 ? '' : 's'} found</b>
        <ol>${items.slice(0, 8).map(i => `<li><span class="mat-type">${esc(i.type)}</span> ${esc(i.question.slice(0, 110))}${i.topic ? ` <span class="lp-tag">${esc(i.topic)}</span>` : ''}</li>`).join('')}</ol>
        ${items.length > 8 ? `<p class="qs-muted">…and ${items.length - 8} more</p>` : ''}</div>
        <div class="bk-foot"><span></span><button class="btn btn-primary btn-sm" onclick="qbCsvImport()"><i class="fas fa-file-import"></i> Import ${items.length}</button></div>`;
    };
    fr.readAsText(f);
  };
  window.qbCsvImport = async function () {
    const items = window._qbImportItems || [];
    try {
      const r = await post('/qbank/import', { items });
      if (!r || !r.success) throw new Error((r && r.message) || 'Import failed.');
      closeLearnModal('qbImport'); QB.topics = null;
      const errs = (r.errors || []).slice(0, 5).map(e => `row ${e.row + 1}: ${e.message}`).join('; ');
      showToast(`✅ ${r.added} imported${r.skipped ? `, ${r.skipped} duplicates skipped` : ''}${r.errors && r.errors.length ? ` — ${r.errors.length} rows had problems (${errs})` : ''}.`, r.errors && r.errors.length ? 'info' : 'success');
      renderQBank();
    } catch (e) { showToast(e.message, 'error'); }
  };
  window.qbSampleCsv = function () {
    const csv = '﻿question,type,a,b,c,d,correct,min,max,marks,negative,topic,difficulty,explanation\n' +
      '"Which force opposes the relative motion between two surfaces in contact?",single,Gravity,Friction,Tension,Buoyancy,B,,,4,1,Friction,easy,"Friction opposes relative motion."\n' +
      '"Pick the vector quantities",multiple,Velocity,Mass,Force,Time,A;C,,,4,2,Kinematics,medium,\n' +
      '"$2 + 5 = ?$",integer,,,,,7,,,4,1,Arithmetic,easy,\n' +
      '"Value of $g$ in m/s$^2$",numerical,,,,,,9.7,9.9,4,0,Gravity,easy,\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    if (window.__aeroSaveBlob) return window.__aeroSaveBlob(blob, 'question-bank-sample.csv');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'question-bank-sample.csv';
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* ============================================================
     GRADING — test series manager + report card
     ============================================================ */
  window.renderSeriesManager = async function () {
    const box = $id('grSeriesBox'); if (!box) return;
    let d;
    try { d = await api(`/admin/series?_t=${Date.now()}`); if (!d || !d.success) throw new Error(); } catch (_) { box.innerHTML = ''; return; }
    box.innerHTML = `<section class="gr-card">
      <div class="gr-card-head"><h3><i class="fas fa-trophy"></i> Test series <span class="qs-muted">rank students across several tests</span></h3>
        <button class="btn btn-outline btn-sm" onclick="seriesEdit()"><i class="fas fa-plus"></i> New series</button></div>
      ${d.series.length ? `<div class="sr-list">${d.series.map(s => `
        <div class="sr-item">
          <div class="sr-main"><b>${esc(s.title)}</b> ${s.published ? '' : '<span class="qs-chip">hidden</span>'}
            <span class="qs-muted">${s.tests.length} tests · ${s.participants} students${s.top[0] ? ` · leader ${esc(s.top[0].name)} (${s.top[0].pct}%)` : ''}</span></div>
          <span class="qb-acts"><button class="quiz-icon-btn" title="Edit" onclick="seriesEdit('${s.id}')"><i class="fas fa-pen"></i></button>
            <button class="quiz-icon-btn danger" title="Delete" onclick="seriesDelete('${s.id}')"><i class="fas fa-trash-alt"></i></button></span>
        </div>`).join('')}</div>` : '<p class="qs-muted">No series yet. Group 2 or more tests — students see a combined leaderboard in Practice → Test series.</p>'}
    </section>`;
    window._seriesList = d.series;
  };
  window.seriesEdit = function (id) {
    const s = id ? (window._seriesList || []).find(x => x.id === id) : null;
    const tests = (GR.home && GR.home.tests) || [];
    const chosen = new Set(s ? s.tests.map(t => t.materialId) : []);
    modal('series', `<div class="bk-head"><h3><i class="fas fa-trophy"></i> ${s ? 'Edit' : 'New'} test series</h3>
        <button class="btn btn-outline btn-sm" onclick="closeLearnModal('series')"><i class="fas fa-xmark"></i></button></div>
      <div class="form-group"><label>Name</label><input type="text" id="srTitle" maxlength="120" value="${esc(s ? s.title : '')}" placeholder="e.g. JEE Main Mock Series 2026"></div>
      <div class="form-group"><label>Description <span class="qs-muted">(optional)</span></label><input type="text" id="srDesc" maxlength="600" value="${esc(s ? s.description : '')}"></div>
      <div class="form-group"><label>Tests <span class="qs-muted">— pick 2 or more</span></label>
        <div class="sr-pick">${tests.length ? tests.map(t => `<label class="ap-topic"><input type="checkbox" value="${esc(t.materialId)}" ${chosen.has(t.materialId) ? 'checked' : ''}><span>${esc(t.title)} <span class="qs-muted">· ${esc(t.courseCode || t.courseName)}</span></span><em>${t.questions} Q</em></label>`).join('') : '<p class="qs-muted">No tests found.</p>'}</div></div>
      <label class="qe-check"><input type="checkbox" id="srPub" ${!s || s.published ? 'checked' : ''}><span>Visible to students</span></label>
      <div class="bk-foot"><span></span><span><button class="btn btn-outline btn-sm" onclick="closeLearnModal('series')">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="seriesSave('${s ? s.id : ''}')"><i class="fas fa-check"></i> Save</button></span></div>`);
  };
  window.seriesSave = async function (id) {
    const body = {
      title: $id('srTitle').value.trim(), description: $id('srDesc').value.trim(), published: $id('srPub').checked,
      tests: [...document.querySelectorAll('.sr-pick input:checked')].map(i => ({ materialId: i.value }))
    };
    try {
      const r = id ? await api(`/admin/series/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) : await post('/admin/series', body);
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not save.');
      closeLearnModal('series'); showToast('✅ Test series saved.', 'success');
      window.renderSeriesManager();
    } catch (e) { showToast(e.message, 'error'); }
  };
  window.seriesDelete = async function (id) {
    if (!(await quizConfirm({ title: 'Delete this series?', icon: 'fa-trash', danger: true, ok: 'Delete', text: 'The tests and their results stay — only the combined ranking is removed.' }))) return;
    try {
      const r = await api(`/admin/series/${id}`, { method: 'DELETE' });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not delete.');
      window.renderSeriesManager();
    } catch (e) { showToast(e.message, 'error'); }
  };
})();
