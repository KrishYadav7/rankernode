/* ============================================================
   RANKERNODE DOCUMENT VIEWER — v2 (Fallback-enabled)
   ------------------------------------------------------------
   Universal viewer for any non-PDF, non-video material:
     • PowerPoint   (.pptx .ppt .ppsx .pps)  → Office/Google viewer
     • Word         (.docx .doc .rtf .odt)   → Office/Google viewer
     • Excel/CSV    (.xlsx .xls .csv .ods)   → Office/Google viewer
     • Images       (.png .jpg .gif .webp …) → inline <img>
     • Text         (.txt .md .log .json …)  → <pre>

   NEW in v2:
     • Microsoft Office viewer is tried first.
     • If it times out (7s) or crashes, it automatically falls
       back to Google Docs Viewer.
     • If both fail, a clean "Download / Open in new tab" card
       is shown.
   ============================================================ */
(function () {
  'use strict';
  if (window.__AERO_DOCUMENT_VIEWER_LOADED__) return;
  window.__AERO_DOCUMENT_VIEWER_LOADED__ = true;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[DocumentViewer]', msg);
  }

  function detectDocType(fileName, url) {
    const hay = (String(fileName || '') + ' ' + String(url || ''))
      .toLowerCase().split('?')[0].split('#')[0];
    const m = hay.match(/\.([a-z0-9]{1,6})(?:\s|$|\/|&|,)/);
    const ext = m ? m[1] : '';

    if (['pptx', 'ppt', 'ppsx', 'pps', 'potx', 'pot'].includes(ext)) return 'presentation';
    if (['docx', 'doc', 'rtf', 'odt'].includes(ext))  return 'document';
    if (['xlsx', 'xls', 'csv', 'ods'].includes(ext))  return 'spreadsheet';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini'].includes(ext)) return 'text';
    if (['pdf'].includes(ext)) return 'pdf';
    return 'unknown';
  }

  function makeWatermarkUrl(text, opts) {
    opts = opts || {};
    const color = opts.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const size  = opts.size || 11;
    const angle = opts.angle || -25;
    const tile  = opts.tile || 900;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + tile + '" height="' + tile + '">' +
        '<text x="50%" y="50%" font-family="Inter,Arial,sans-serif" font-size="' + size + '" ' +
        'font-weight="700" fill="' + color + '" text-anchor="middle" ' +
        'transform="rotate(' + angle + ' ' + (tile / 2) + ' ' + (tile / 2) + ')">' +
          _esc(text) +
        '</text>' +
      '</svg>';
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
  }

  class DocumentViewer {
    constructor() {
      this.active       = false;
      this.modal        = null;
      this.username     = '';
      this.title        = '';
      this.fileName     = '';
      this.fileUrl      = '';
      this.courseId     = null;
      this.materialId   = null;
      this.docType      = 'unknown';
      this._prevOverflow = '';
      this._onKeyDown   = this._onKeyDown.bind(this);
      this._officeAttempt = 0;
      this._officeTimer = null;
    }

    open(opts) {
      opts = opts || {};
      if (this.active) return;

      const kind = opts.docType || detectDocType(opts.fileName, opts.url);
      if (kind === 'pdf' && window.PDFViewer && typeof window.PDFViewer.open === 'function') {
        return window.PDFViewer.open({
          url:      opts.url,
          title:    opts.title,
          fileName: opts.fileName,
          materialId: opts.materialId,
          courseId:   opts.courseId,
          username:   opts.username,
          hasFullAccess: opts.hasFullAccess,
          previewPercent: opts.previewPercent,
          lockReason: opts.lockReason
        });
      }

      this.active     = true;
      this.username   = opts.username || 'Student';
      this.title      = opts.title || opts.fileName || 'Document';
      this.fileName   = opts.fileName || '';
      this.courseId   = opts.courseId || null;
      this.materialId = opts.materialId || null;
      this.docType    = kind;
      this._officeAttempt = 0;

      let rawUrl = String(opts.url || '').trim();
      if (rawUrl && !/^(https?:|blob:|data:)/i.test(rawUrl)) {
        try { rawUrl = new URL(rawUrl, location.origin).href; }
        catch (e) { /* leave as-is */ }
      }
      this.fileUrl = rawUrl;

      this._prevOverflow = document.body.style.overflow;
      this._buildUI();
      this.modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this._onKeyDown, true);

      if (this.docType === 'image') {
        this._renderImage();
      } else if (this.docType === 'text') {
        this._renderText();
      } else if (this.docType === 'presentation' ||
                 this.docType === 'document' ||
                 this.docType === 'spreadsheet') {
        this._renderOffice();
      } else {
        this._renderUnsupported();
      }
    }

    _buildUI() {
      const old = document.getElementById('docViewerModal');
      if (old) old.remove();

      const el = document.createElement('div');
      el.id = 'docViewerModal';
      el.className = 'doc-viewer-modal';

      el.innerHTML = `
        <div class="docv-shell" oncontextmenu="return false;">
          <div class="docv-toolbar">
            <div class="docv-toolbar-left">
              <button type="button" class="docv-back-btn" data-act="close" title="Back (Esc)">
                <i class="fas fa-arrow-left"></i><span>Back</span>
              </button>
              <span class="docv-title" id="docvTitle">${_esc(this.title)}</span>
            </div>
            <div class="docv-toolbar-right">
              <button type="button" class="docv-btn" data-act="close" title="Close (Esc)">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
          <div class="docv-body" id="docvBody">
            <div class="docv-loader">
              <div class="docv-spinner"></div>
              <p>Preparing document…</p>
            </div>
          </div>
        </div>`;

      document.body.appendChild(el);
      this.modal = el;

      el.querySelectorAll('[data-act="close"]').forEach(b => {
        b.addEventListener('click', () => this.close());
      });
      el.addEventListener('click', e => { if (e.target === el) this.close(); });

      this._renderWatermark();
    }

    /* 2026-10-04: visible watermarks removed (owner's decision). */
    _renderWatermark() { /* intentionally no-op */ }

    _renderImage() {
      const body = this.modal.querySelector('#docvBody');
      body.innerHTML = `
        <div class="docv-image-wrap">
          <img src="${_esc(this.fileUrl)}" alt="${_esc(this.title)}"
               loading="eager" decoding="async">
        </div>`;
    }

    async _renderText() {
      const body = this.modal.querySelector('#docvBody');
      body.innerHTML = `
        <div class="docv-loader">
          <div class="docv-spinner"></div>
          <p>Loading text file…</p>
        </div>`;
      try {
        const res = await fetch(this.fileUrl, { cache: 'default', credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        body.innerHTML = `
          <div class="docv-text-wrap">
            <pre class="docv-text">${_esc(text)}</pre>
          </div>`;
      } catch (err) {
        this._renderError('Could not load the text file. ' + (err.message || ''));
      }
    }
    /* ------------------------------------------------------------
       Office documents — Show a clean download card.
       ------------------------------------------------------------
       External viewers (Microsoft, Google) cannot access files
       behind authentication (like our signed URLs). When they fail,
       the browser renders raw PPTX/DOCX text vertically, which looks
       broken. Instead, we show a clean "Download to view" card.
       ------------------------------------------------------------ */
    /* ⭐ 2026-10-04: no download / open-in-new-tab anywhere. Office files
       are rendered server-side and shown in the protected PDF viewer
       (see openRenderedOfficeFile in app.js); this card only appears if
       something routes an office file here by mistake. */
    _renderOffice() {
      const body = this.modal.querySelector('#docvBody');
      body.innerHTML = `
        <div class="docv-unsupported">
          <i class="fas fa-person-chalkboard" style="color:#d24726;"></i>
          <h3>Opening in the RankerNode viewer</h3>
          <p>This file is shown inside the app only. Please close this window and press <strong>Read</strong> again.</p>
          <button type="button" class="btn btn-primary btn-lg" onclick="window.DocumentViewer.close()">
            <i class="fas fa-arrow-left"></i> Back
          </button>
        </div>`;
    }

    _renderUnsupported() {
      if (this._officeTimer) clearTimeout(this._officeTimer);
      const body = this.modal.querySelector('#docvBody');
      body.innerHTML = `
        <div class="docv-unsupported">
          <i class="fas fa-file"></i>
          <h3>Preview not available</h3>
          <p>This file can only be viewed inside RankerNode and could not be displayed right now. Please try again later.</p>
          <button type="button" class="btn btn-outline btn-lg" onclick="window.DocumentViewer.close()">
            <i class="fas fa-arrow-left"></i> Back
          </button>
        </div>`;
    }

    _retryViewers() {
      this._officeAttempt = 0;
      this._renderOffice();
    }

    _renderError(msg) {
      const body = this.modal.querySelector('#docvBody');
      body.innerHTML = `
        <div class="docv-unsupported">
          <i class="fas fa-triangle-exclamation"></i>
          <h3>Could not load document</h3>
          <p>${_esc(msg)}</p>
          <button type="button" class="btn btn-primary" onclick="window.DocumentViewer.close()">
            <i class="fas fa-arrow-left"></i> Back
          </button>
        </div>`;
    }

    _onKeyDown(e) {
      if (!this.active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    }

    close() {
      if (!this.active) return;
      this.active = false;
      if (this._officeTimer) clearTimeout(this._officeTimer);
      document.removeEventListener('keydown', this._onKeyDown, true);
      document.body.style.overflow = this._prevOverflow || '';

      const m = this.modal;
      if (m) {
        m.classList.remove('active');
        setTimeout(() => { try { m.remove(); } catch (e) {} }, 240);
      }
      this.modal = null;
    }
  }

  window.DocumentViewer = new DocumentViewer();
  console.log('[DocumentViewer v2] Ready with fallback providers');
})();