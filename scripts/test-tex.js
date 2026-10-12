// Run: node scripts/test-tex.js — LaTeX converter (always) + TeX Live engine (when installed)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'tex-render.js'));
const T = window.AeroTeX;
const conv = (s) => { const figs = []; return { html: T.convert(s, figs), figs }; };

/* text-mode LaTeX → safe HTML */
assert.ok(/<strong>all<\/strong>/.test(conv(String.raw`\textbf{all}`).html), 'textbf');
assert.ok(/<ol class="tex-list" type="a">/.test(conv(String.raw`\begin{enumerate}[(a)]\item x\end{enumerate}`).html), 'enumerate (a)');
assert.ok(/<table class="tex-table/.test(conv(String.raw`\begin{tabular}{|l|r|}\hline a & b \\ \hline\end{tabular}`).html), 'tabular');
assert.ok(/colspan="2"/.test(conv(String.raw`\begin{tabular}{lll} \multicolumn{2}{c}{w} & z \end{tabular}`).html), 'multicolumn');
assert.ok(conv(String.raw`\begin{itemize}\item \begin{equation} E=mc^2 \end{equation}\end{itemize}`).html.includes('\\begin{equation} E=mc^2 \\end{equation}'), 'math inside lists kept for MathJax');
assert.ok(conv(String.raw`Using \eqref{eq:a}`).html.includes('\\eqref{eq:a}'), 'eqref passed to MathJax');
assert.strictEqual(conv(String.raw`50\% off`).html, '50% off', 'escapes');
assert.ok(conv('a--b---c').html === 'a–b—c', 'dashes');
assert.ok(/m\/s²/.test(conv(String.raw`\SI{9.81}{\metre\per\second\squared}`).html), 'siunitx units');
/* safety */
const x = conv(String.raw`<img src=x onerror=alert(1)> \href{javascript:alert(1)}{click} \textcolor{red;background:url(x)}{t} \includegraphics{javascript:x}`).html;
assert.ok(!/<img src=x|(href|src)="javascript:|style="[^"]*url\(/.test(x), 'no html / script / css injection: ' + x);
assert.ok(/&lt;b&gt;/.test(conv(String.raw`\begin{verbatim}<b>\end{verbatim}`).html), 'verbatim escaped');
/* engine blocks */
assert.strictEqual(conv(String.raw`\begin{figure}\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}\caption{c}\end{figure}`).figs.length, 1, 'tikz inside figure → engine');
assert.strictEqual(conv(String.raw`\usetikzlibrary{calc}` + '\n' + String.raw`\begin{tikzpicture}\end{tikzpicture}`).figs[0].part.s.startsWith('\\usetikzlibrary{calc}'), true, 'preamble line travels with its block');
assert.strictEqual(conv(String.raw`\chemfig{A-B}`).figs.length, 1, 'chemfig → engine');
assert.strictEqual(conv(String.raw`\ce{H2O}`).figs.length, 0, '\\ce stays with MathJax');
console.log('✅ LaTeX converter: all checks passed');

/* the real engine (skipped when TeX Live is not on this machine) */
const api = require(path.join(__dirname, '..', 'tex-api.js'));
(async () => {
  const ok = await api.compile(String.raw`\begin{tikzpicture}\draw (0,0) circle (1);\end{tikzpicture}`);
  if (ok.missing) { console.log('ℹ️  TeX Live not installed here — engine checks skipped'); return; }
  assert.ok(ok.ok && ok.pages.length === 1 && /<svg/.test(ok.pages[0]), 'tikz compiles to SVG');
  const err = await api.compile('\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\nosuchmacro\n\\end{tikzpicture}');
  assert.ok(!err.ok && err.line === 3 && /Undefined control sequence/.test(err.error), 'error with the author\'s line number');
  const rd = await api.compile(String.raw`\input{/etc/passwd}`);
  assert.ok(!rd.ok, 'cannot read files outside the job');
  await api.compile(String.raw`\immediate\write18{touch /tmp/aero_tex_test_pwned}x`);
  assert.ok(!fs.existsSync('/tmp/aero_tex_test_pwned'), 'cannot run shell commands');
  console.log('✅ LaTeX engine: compiles, reports lines, sandboxed');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
