'use strict';
/* ============================================================
   ⚡ PDF FAST-VIEW OPTIMIZER (2026-10-07)
   ------------------------------------------------------------
   Makes a light "fast-view" copy of a PDF for on-screen reading.
   The original file is never modified (downloads / admins keep it).

   Why: scanned or photographed notes often embed every page as a
   12-megapixel JPEG (≈ 3000 × 4000 px, 700 KB+). A phone screen
   shows ~1500 px across, so the reader was downloading and decoding
   ~4× more pixels than it can display — over a second of CPU per
   page on a phone.

   What it does:
     • every JPEG image larger than the page can ever show at
       PX_PER_PT pixels per point (≈ 290 dpi) is scaled down and
       re-encoded (mozjpeg); images that would not get smaller are
       left exactly as they are;
     • only plain 8-bit RGB / grayscale JPEGs are touched — CMYK,
       Decode arrays, JPX, JBIG2, vector graphics and text are kept
       byte-for-byte;
     • the result is written with object streams so the reader needs
       only a few small requests to find any page.

   API:  optimizePdf(srcPath, outPath, opts) → { changed, images,
         resized, beforeBytes, afterBytes }  (never throws for a PDF
         it cannot improve — returns { changed: false })
   ============================================================ */
const fs = require('fs');

const DEFAULTS = {
  pxPerPt: 4.0,            // ≈ 290 dpi — sharp on retina laptops up to ~170 % zoom (was 2.8 ≈ 200 dpi: soft)
  jpegQuality: 85,         // was 80 — fine print / handwriting kept crisp
  minSavingRatio: 0.85,    // keep a re-encoded image only if ≤ 85 % of the original
  maxInputBytes: 400 * 1024 * 1024
};

async function optimizePdf(srcPath, outPath, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, PDFRef } = require('pdf-lib');
  let sharp;
  try { sharp = require('sharp'); } catch (_) { return { changed: false, reason: 'sharp unavailable' }; }

  const st = await fs.promises.stat(srcPath);
  if (st.size > o.maxInputBytes) return { changed: false, reason: 'too large' };
  const bytes = await fs.promises.readFile(srcPath);
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    return { changed: false, reason: 'unreadable: ' + e.message };
  }
  const ctx = doc.context;
  const N = (n) => PDFName.of(n);
  const num = (v) => (v instanceof PDFNumber ? v.asNumber() : NaN);

  /* Largest page each image appears on (points). Images used on no
     page we can see get the largest page in the document. */
  const imgPage = new Map();        // ref string → { w, h }
  let maxPage = { w: 0, h: 0 };
  const visitXObjects = (resources, size, depth) => {
    if (!resources || depth > 3) return;
    const xo = resources.lookup(N('XObject'));
    if (!(xo instanceof PDFDict)) return;
    for (const [, ref] of xo.entries()) {
      if (!(ref instanceof PDFRef)) continue;
      const obj = ctx.lookup(ref);
      if (!obj || !obj.dict) continue;
      const sub = obj.dict.get(N('Subtype'));
      if (sub === N('Image')) {
        const k = ref.toString();
        const prev = imgPage.get(k);
        if (!prev || size.w * size.h > prev.w * prev.h) imgPage.set(k, size);
      } else if (sub === N('Form')) {
        visitXObjects(obj.dict.lookup(N('Resources')), size, depth + 1);
      }
    }
  };
  for (const page of doc.getPages()) {
    let w = 0, h = 0;
    try { const s = page.getSize(); w = Math.abs(s.width); h = Math.abs(s.height); } catch (_) {}
    if (!(w > 0 && h > 0)) continue;
    if (w * h > maxPage.w * maxPage.h) maxPage = { w, h };
    try { visitXObjects(page.node.Resources(), { w, h }, 0); } catch (_) {}
  }
  if (!(maxPage.w > 0)) return { changed: false, reason: 'no pages' };

  let images = 0, resized = 0;
  const jobs = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(N('Subtype')) !== N('Image')) continue;
    images++;
    const filter = d.get(N('Filter'));
    const isDct = filter === N('DCTDecode') ||
                  (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === N('DCTDecode'));
    if (!isDct) continue;
    if (d.get(N('DecodeParms')) || d.get(N('Decode')) || d.get(N('ImageMask'))) continue;
    if (num(d.get(N('BitsPerComponent'))) !== 8) continue;
    const cs = d.get(N('ColorSpace'));
    if (cs !== N('DeviceRGB') && cs !== N('DeviceGray')) continue;
    const w = num(d.get(N('Width'))), h = num(d.get(N('Height')));
    if (!(w > 0 && h > 0)) continue;
    const page = imgPage.get(ref.toString()) || maxPage;
    /* the page may be shown rotated; allow for either orientation */
    const maxW = Math.max(page.w, page.h) * o.pxPerPt;
    const fit = Math.min(1, Math.min(Math.max(page.w, page.h) * o.pxPerPt / Math.max(w, h),
                                     Math.min(page.w, page.h) * o.pxPerPt / Math.min(w, h)));
    if (fit > 0.87 || !(maxW > 0)) continue;          // already close to screen size
    jobs.push({ ref, obj, w, h, fit, gray: cs === N('DeviceGray') });
  }
  if (!jobs.length) return { changed: false, images, resized: 0, reason: 'nothing to shrink' };

  for (const j of jobs) {
    const nw = Math.max(1, Math.round(j.w * j.fit));
    const nh = Math.max(1, Math.round(j.h * j.fit));
    let out;
    try {
      let pipe = sharp(Buffer.from(j.obj.contents), { failOn: 'none', limitInputPixels: 2e8 })
        .resize(nw, nh, { fit: 'fill', kernel: 'lanczos3' });
      if (j.gray) pipe = pipe.toColourspace('b-w');
      out = await pipe.jpeg({ quality: o.jpegQuality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    } catch (_) { continue; }
    if (!out || out.info.width !== nw || out.info.height !== nh) continue;
    if ((j.gray ? out.info.channels !== 1 : out.info.channels !== 3)) continue;
    if (out.data.length > j.obj.contents.length * o.minSavingRatio) continue;
    const dict = j.obj.dict.clone(ctx);
    dict.set(N('Width'), PDFNumber.of(nw));
    dict.set(N('Height'), PDFNumber.of(nh));
    dict.set(N('Filter'), N('DCTDecode'));
    dict.delete(N('Length'));
    ctx.assign(j.ref, PDFRawStream.of(dict, new Uint8Array(out.data)));
    resized++;
  }
  if (!resized) return { changed: false, images, resized: 0, reason: 'no image got smaller' };

  const saved = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 100 });
  if (saved.length >= st.size * 0.95) return { changed: false, images, resized, reason: 'no real saving' };
  await fs.promises.writeFile(outPath, saved);
  return { changed: true, images, resized, beforeBytes: st.size, afterBytes: saved.length };
}

/* ============================================================
   ⚡ INSTANT POSTERS (2026-10-07)
   ------------------------------------------------------------
   Small JPEG pictures of the first pages, shown the moment a
   student opens the PDF (≈ 60–120 KB each) while the real page is
   prepared behind them. Pages that are one full-page picture
   (scans / photographed notes) are cut straight from that picture
   — no PDF renderer needed. Other pages are reported in `missing`
   so the server can draw them with pdftoppm when it is installed.
   Writes <prefix>1.jpg … and <prefix>info.json
   ============================================================ */
async function makePosters(srcPath, prefix, opts) {
  const o = Object.assign({ pages: 3, width: 1000, quality: 72 }, opts || {});
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, PDFRef } = require('pdf-lib');
  const sharp = require('sharp');
  const bytes = await fs.promises.readFile(srcPath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const ctx = doc.context;
  const N = (n) => PDFName.of(n);
  const num = (v) => (v instanceof PDFNumber ? v.asNumber() : NaN);
  const { decodePDFRawStream } = require('pdf-lib');
  const contentOf = (page) => {
    const c = page.node.Contents();
    const parts = [];
    const add = (st) => {
      if (!st) return;
      try { parts.push(Buffer.from(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents()).toString('latin1')); }
      catch (_) { parts.push('\u0000UNREADABLE'); }
    };
    if (c instanceof PDFArray) { for (let k = 0; k < c.size(); k++) add(ctx.lookup(c.get(k))); }
    else add(c);
    return parts.join('\n');
  };
  /* A page that only draws one picture (scan / photo): returns true and
     writes the poster, placing the picture exactly where the page puts it
     (photos are often letter-boxed with white margins). */
  const posterFromSinglePicture = async (page, n, w, h, rot) => {
    if (rot || !(w > 0 && h > 0)) return false;
    const res = page.node.Resources();
    const xo = res && res.lookup(N('XObject'));
    if (!(xo instanceof PDFDict)) return false;
    const text = contentOf(page);
    if (text.indexOf('\u0000UNREADABLE') >= 0) return false;
    /* nothing visible besides the picture: no text shown, no paths painted */
    if (/\b(Tj|TJ)\b|['"]\s*$|\bre\b|\b[fFsSbB]\*?\s|\bsh\b|\bBI\b/m.test(text.replace(/BT[\s\S]*?ET/g, (m) => /\b(Tj|TJ)\b/.test(m) ? m : ''))) return false;
    const draws = [...text.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm\s*\/([^\s/]+)\s+Do/g)];
    if (draws.length !== 1 || (text.match(/\bDo\b/g) || []).length !== 1) return false;
    const [, a, b, c, d, e, f, name] = draws[0];
    const A = +a, B = +b, C = +c, D = +d, E = +e, F = +f;
    if (Math.abs(B) > 1e-3 || Math.abs(C) > 1e-3 || !(A > 0) || !(D > 0)) return false;
    const ref = xo.get(N(name));
    const img = ref instanceof PDFRef ? ctx.lookup(ref) : null;
    if (!(img instanceof PDFRawStream) || img.dict.get(N('Subtype')) !== N('Image')) return false;
    const dd = img.dict;
    const fl = dd.get(N('Filter'));
    const isDct = fl === N('DCTDecode') || (fl instanceof PDFArray && fl.size() === 1 && fl.get(0) === N('DCTDecode'));
    const cs = dd.get(N('ColorSpace'));
    if (!isDct || !(cs === N('DeviceRGB') || cs === N('DeviceGray')) || dd.get(N('Decode')) || dd.get(N('SMask'))) return false;
    /* page box origin (MediaBox may not start at 0,0) */
    let x0 = 0, y0 = 0;
    try { const mb = page.getMediaBox(); x0 = mb.x; y0 = mb.y; } catch (_) {}
    const W = o.width, H = Math.round(o.width * h / w), k = W / w;
    const left = Math.round((E - x0) * k), top = Math.round((h - (F - y0) - D) * k);
    const iw = Math.max(1, Math.round(A * k)), ih = Math.max(1, Math.round(D * k));
    if (left < -2 || top < -2 || left + iw > W + 2 || top + ih > H + 2) return false;   // picture spills off the page
    const pic = await sharp(Buffer.from(img.contents), { failOn: 'none' }).resize(iw, ih, { fit: 'fill' }).toBuffer();
    const out = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
      .composite([{ input: pic, left: Math.max(0, left), top: Math.max(0, top) }])
      .jpeg({ quality: o.quality, mozjpeg: true }).toBuffer();
    await fs.promises.writeFile(prefix + n + '.jpg', out);
    return true;
  };
  const pages = doc.getPages();
  const info = { numPages: pages.length, pages: {}, made: [], missing: [] };
  const count = Math.min(o.pages, pages.length);
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    const page = pages[i];
    let w = 0, h = 0;
    try { const sz = page.getSize(); w = Math.abs(sz.width); h = Math.abs(sz.height); } catch (_) {}
    let rot = 0;
    try { const r = page.getRotation(); rot = ((r && r.angle) || 0) % 360; } catch (_) {}
    if (rot === 90 || rot === 270) { const t = w; w = h; h = t; }
    info.pages[n] = { w, h };
    let made = false;
    try {
      made = await posterFromSinglePicture(page, n, w, h, rot);
    } catch (_) { made = false; }
    (made ? info.made : info.missing).push(n);
  }
  await fs.promises.writeFile(prefix + 'info.json', JSON.stringify(info));
  return info;
}

module.exports = { optimizePdf, makePosters, OPTIMIZER_DEFAULTS: DEFAULTS };

/* ---- Child-process mode ------------------------------------------------
   server.js runs the optimizer as a separate, low-priority process:
     node pdf-optimizer.js <src> <out>
   pdf-lib parses the whole file with synchronous JavaScript, which would
   freeze the web server for seconds if it ran inside it. Prints one line
   of JSON with the result. */
if (require.main === module) {
  const args = process.argv.slice(2);
  try { require('sharp').concurrency(1); } catch (_) {}
  const posters = args[0] === '--posters';
  const [src, out] = posters ? args.slice(1) : args;
  (posters ? makePosters(src, out) : optimizePdf(src, out))
    .then((r) => { process.stdout.write(JSON.stringify(r) + '\n'); process.exit(0); })
    .catch((e) => { process.stdout.write(JSON.stringify({ changed: false, reason: 'error: ' + (e && e.message) }) + '\n'); process.exit(0); });
}
