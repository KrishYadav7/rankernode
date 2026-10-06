/* ============================================================
   RANKERNODE MEDIA VIEWER v5
   - Fixed YouTube playback (youtube-nocookie, no bad origin param)
   - Stronger screenshot deterrence (blur-before-capture, DRM hooks)
   - Traceable watermarks (name + session + timestamp)
   ============================================================ */
(function () {
  'use strict';
  if (window.__AERO_MEDIA_VIEWER_LOADED__) return;
  window.__AERO_MEDIA_VIEWER_LOADED__ = true;

  /* ---------- Utilities ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' })[c]);
  }
  function _escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
  }
  function makeWatermarkUrl(text, opts) {
    opts = opts || {};
    const color = opts.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const size  = opts.size  || 11;
    const angle = opts.angle || -25;
    const tile  = opts.tile  || 900;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="'+tile+'" height="'+tile+'">' +
        '<text x="50%" y="50%" font-family="Inter,Arial,sans-serif" font-size="'+size+'" ' +
        'font-weight="700" fill="'+color+'" text-anchor="middle" ' +
        'transform="rotate('+angle+' '+(tile/2)+' '+(tile/2)+')">' +
          escapeXml(text) +
        '</text>' +
      '</svg>';
    return 'url("data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)+'")';
  }
  /* ------------------------------------------------------------
     dataURLToBytes — native fast-path base64 decode.
     ------------------------------------------------------------
     The old implementation used atob() + a JS charCodeAt loop.
     For a 30 MB PDF that meant ~40 million JS iterations on the
     main thread, blocking page 1 from rendering for 400–800 ms.

     Browsers expose a native decode path via fetch() on the data
     URL. It runs in C++ and returns an ArrayBuffer directly —
     typically 5–10× faster than the manual loop.

     The manual loop is kept as a fallback in case fetch() is
     unavailable or the browser blocks data: URLs.
     ------------------------------------------------------------ */
  async function dataURLToBytes(dataURL) {
    const isBase64 = dataURL.indexOf(';base64,') !== -1;

    /* Fast path — let the browser decode */
    if (isBase64 && typeof fetch === 'function') {
      try {
        const res = await fetch(dataURL);
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) {
        /* fall through to slow path */
      }
    }

    /* Slow path (original behaviour, kept as fallback) */
    const idx = dataURL.indexOf(',');
    const meta = dataURL.slice(0, idx);
    const b64 = dataURL.slice(idx + 1);
    if (meta.indexOf('base64') === -1) {
      const text = decodeURIComponent(b64);
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
      return out;
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function userToast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[MediaViewer]', msg);
  }

  /* ------------------------------------------------------------
     Highlighter palette — 8 soft, readable colors.
     Alpha tuned to ~40-45% so text stays perfectly legible.
     ------------------------------------------------------------ */
  const HL_COLORS = {
    yellow: 'rgba(255, 224, 102, 0.45)',   // warm classroom yellow
    green:  'rgba(134, 239, 172, 0.45)',   // soft mint
    blue:   'rgba(147, 197, 253, 0.45)',   // sky
    pink:   'rgba(249, 168, 212, 0.45)',   // rose
    orange: 'rgba(253, 186, 116, 0.45)',   // peach
    purple: 'rgba(196, 181, 253, 0.42)',   // lavender
    cyan:   'rgba(103, 232, 249, 0.40)',   // aqua
    red:    'rgba(252, 165, 165, 0.42)'    // coral
  };

  const HL_COLOR_LABELS = {
    yellow: 'Yellow', green: 'Mint', blue: 'Sky', pink: 'Rose',
    orange: 'Peach',  purple: 'Lavender', cyan: 'Aqua', red: 'Coral'
  };

  /* ============================================================
     GLOBAL SCREEN-RECORDING BLOCK
     Hook getDisplayMedia so browser-based screen recorders
     (Chrome "Record tab", Firefox, OBS-Web, Loom, etc.) cannot
     capture a tab that has an active viewer open.
     ============================================================ */
  (function blockDisplayCapture() {
    if (!navigator.mediaDevices) return;
    const orig = navigator.mediaDevices.getDisplayMedia;
    if (typeof orig !== 'function') return;
    navigator.mediaDevices.getDisplayMedia = async function (...args) {
      if ((window.PDFViewer && window.PDFViewer.active) ||
          (window.VideoPlayer && window.VideoPlayer.active)) {
        try { userToast('Screen recording is disabled for protected content.', 'error'); } catch(e){}
        throw new DOMException('Screen capture disabled', 'NotAllowedError');
      }
      return orig.apply(this, args);
    };
    console.log('[MediaViewer] getDisplayMedia hook installed');
  })();

  /* ============================================================
     GLOBAL SCREENSHOT-KEY DETECTOR
     Fires the moment a screenshot key is pressed — before most
     desktop screenshot tools finish their capture. Also clears the
     clipboard on PrintScreen so the naive copy-to-clipboard path
     produces nothing usable.
     ============================================================ */
  function fireProtectionBlur() {
    const pdf = window.PDFViewer;
    const vid = window.VideoPlayer;
    if (pdf && pdf.active && typeof pdf._flashBlur === 'function') pdf._flashBlur();
    if (vid && vid.active && typeof vid._flashBlur === 'function') vid._flashBlur();
  }

  document.addEventListener('keydown', (e) => {
    const key = e.key;
    const isPrint = key === 'PrintScreen' || e.keyCode === 44;
    const isMacShot = (e.metaKey || e.ctrlKey) && e.shiftKey &&
                      ['3','4','5','s','S'].includes(key);
    if (!isPrint && !isMacShot) return;

    /* The site-wide content shield (content-shield.js) shows the single
       "Content protected" window and poisons the clipboard; here we only
       blur an open viewer underneath it. No extra toast — one attempt,
       one message. */
    fireProtectionBlur();
  }, true);

  /* ------------------------------------------------------------
     NOTE: We intentionally do NOT listen for `window.blur` here.

     Browser fullscreen transitions (F11, the browser's fullscreen
     button, and the Fullscreen API) fire a blur+focus pair on the
     window every time the user toggles fullscreen. Hooking that
     event to fireProtectionBlur() made the PDF / video shell go
     blurry on every expand AND every restore — which is exactly
     the "document becomes fuzzy when toggling fullscreen" bug.

     Screenshot protection is still fully intact via the keydown
     handler above, which is the ONLY path that should ever blur
     the shell.
     ------------------------------------------------------------ */

/* ============================================================
   VIDEO PLAYER v6 — Advanced Custom Controls
   ------------------------------------------------------------
   Blocks every YouTube redirect surface and replaces the
   YouTube chrome with a rich, native-feeling control bar.
   PDFViewer and the helpers above are untouched.
   ============================================================ */
class VideoPlayer {
  constructor() {
    this.active = false;
    this.modal = null;
    this.videoArea = null;
    this.titleEl = null;
    this.playlistPanel = null;
    this.playlistItemsEl = null;
    this.watermarkEl = null;
    this.playlist = [];
    this.playlistIndex = 0;
    this.playlistTitle = '';
    this.username = '';

    /* Player state */
    this.playerKind = null;        // 'youtube' | 'direct'
    this.ytPlayer = null;          // YT.Player instance
    this.videoEl = null;           // HTMLVideoElement (direct)
    this.videoId = null;           // YT ID or direct URL (identity key)
    this.duration = 0;
    this.isPlaying = false;
    this.volume = 1;
    this.isMuted = false;
    this.playbackRate = 1;
    this.looping = false;
    this.captionsOn = false;
    this.theater = false;

    /* UI state */
    this.controlsVisible = true;
    this.controlsTimer = null;
    this.rafId = null;
    this.ytReady = false;
    this._ytApiPromise = null;

    /* Persistence */
    this.bookmarks = [];
    this._resumePos = 0;

    /* Bound listeners */
    this._onKeyDown     = this._onKeyDown.bind(this);
    this._onMouseMove   = this._onMouseMove.bind(this);
    this._onMouseLeave  = this._onMouseLeave.bind(this);
    this._tick          = this._tick.bind(this);
  }

  /* ------------------------------------------------------------
     Public API
     ------------------------------------------------------------ */
  async open(opts) {
    if (this.active) this.close();
    this.active = true;

    this.username = opts.username || 'Student';
    this.playlist = opts.playlist || [];
    this.playlistIndex = opts.playlistIndex || 0;
    this.playlistTitle = opts.playlistTitle || '';
    this.videoId = opts.videoId || opts.materialId || opts.title || 'video';
    /* ⭐ Watch-progress identity (synced to the server by app.js) */
    this.courseId = opts.courseId || null;
    this.materialId = opts.materialId || null;
    this._lastReportedPos = -1;
    this._lastReportAt = 0;

    this._buildUI();
    this._renderWatermark();
    this._loadBookmarks();
    this._bindGlobalEvents();

    if (this.playlist.length > 0) {
      this._renderPlaylist();
      this.modal.querySelector('#vpPlaylistToggle').style.display = 'inline-flex';
      this.modal.querySelector('#vpPlaylistTitle').textContent = this.playlistTitle || 'Playlist';
      await this._loadPlaylistItem(this.playlistIndex);
    } else {
      await this._loadSingle(opts);
    }

    this.modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    this._renderSpeedMenu();
    this._startTick();
    this._scheduleControlsHide();
    this._showToast('Tip: press ? for keyboard shortcuts');
  }

  close() {
    if (!this.active) return;
    this._reportProgress('close');
    this.active = false;

    this._saveResume();
    this._stopTick();
    clearTimeout(this.controlsTimer);

    if (this.ytPlayer) {
      try { this.ytPlayer.destroy(); } catch (e) {}
      this.ytPlayer = null;
    }
    if (this.videoEl) {
      try { this.videoEl.pause(); this.videoEl.removeAttribute('src'); this.videoEl.load(); } catch (e) {}
      this.videoEl = null;
    }

    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('mousemove', this._onMouseMove);
    if (this.modal) this.modal.removeEventListener('mouseleave', this._onMouseLeave);
    document.removeEventListener('fullscreenchange', this._onFsChange);
    document.removeEventListener('webkitfullscreenchange', this._onFsChange);
    document.body.style.overflow = '';

    const m = this.modal;
    if (m) {
      m.classList.remove('active');
      setTimeout(() => { try { m.remove(); } catch (e) {} }, 240);
    }
    this.modal = null;
    this.playlist = [];
    this.playlistIndex = 0;
    try { window.dispatchEvent(new CustomEvent('aero:video-closed', { detail: { courseId: this.courseId } })); } catch (e) {}
  }

  /* ------------------------------------------------------------
     UI construction
     ------------------------------------------------------------ */
  _buildUI() {
    const old = document.getElementById('videoPlayerModal');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'videoPlayerModal';
    el.className = 'video-player-modal';
    el.innerHTML = `
      <div class="vp-shell" id="vpShell">
        <button class="vp-back-btn" id="vpBackBtn" title="Back (Esc)">
          <i class="fas fa-arrow-left"></i> <span>Back</span>
        </button>
        <button class="vp-playlist-toggle" id="vpPlaylistToggle" style="display:none;" title="Playlist">
          <i class="fas fa-list"></i> <span>Playlist</span>
        </button>
        <div class="vp-title" id="vpTitle"></div>

        <div class="vp-video-area" id="vpVideoArea">
          <div class="vp-click-capture" id="vpClickCapture" tabindex="0" aria-label="Video surface"></div>
          <button class="vp-big-play" id="vpBigPlay" type="button" aria-label="Play"><i class="fas fa-play"></i></button>
        </div>

        <div class="vp-playlist-panel" id="vpPlaylistPanel">
          <div class="vp-playlist-header">
            <h4 id="vpPlaylistTitle"><i class="fas fa-list"></i> Playlist</h4>
            <button class="vp-playlist-close" id="vpPlaylistClose" aria-label="Close playlist"><i class="fas fa-times"></i></button>
          </div>
          <div class="vp-playlist-items" id="vpPlaylistItems"></div>
        </div>

        <div class="vp-controls" id="vpControls">
          <div class="vp-progress-row" id="vpProgressRow">
            <div class="vp-progress-bg"></div>
            <div class="vp-progress-buffered" id="vpProgressBuffered"></div>
            <div class="vp-progress-filled" id="vpProgressFilled"></div>
            <div class="vp-thumb" id="vpProgressThumb"></div>
            <div class="vp-tooltip" id="vpProgressTooltip"></div>
          </div>
          <div class="vp-buttons">
            <button class="vp-btn" id="vpPlayBtn" title="Play/Pause (Space)"><i class="fas fa-play"></i></button>
            <button class="vp-btn" id="vpPrevBtn" title="Previous (P)"><i class="fas fa-backward-step"></i></button>
            <button class="vp-btn" id="vpNextBtn" title="Next (N)"><i class="fas fa-forward-step"></i></button>
            <button class="vp-btn" id="vpBack10Btn" title="Back 10s (J)"><i class="fas fa-rotate-left"></i></button>
            <button class="vp-btn" id="vpFwd10Btn" title="Forward 10s (L)"><i class="fas fa-rotate-right"></i></button>

            <div class="vp-volume-wrap">
              <button class="vp-btn" id="vpMuteBtn" title="Mute (M)"><i class="fas fa-volume-high"></i></button>
              <div class="vp-volume">
                <input type="range" id="vpVolumeRange" min="0" max="100" value="100" aria-label="Volume">
              </div>
            </div>

            <span class="vp-time" id="vpTime">0:00 / 0:00</span>
            <span class="vp-spacer"></span>

            <div class="vp-menu-wrap">
              <button class="vp-btn" id="vpBmBtn" title="Bookmarks (B)"><i class="fas fa-bookmark"></i></button>
              <div class="vp-menu" id="vpBookmarkMenu">
                <div class="vp-menu-head"><i class="fas fa-bookmark"></i> Bookmarks</div>
                <div class="vp-menu-list" id="vpBookmarkList"></div>
                <button class="vp-menu-add" id="vpBmAddBtn"><i class="fas fa-plus"></i> Save current time</button>
              </div>
            </div>

            <button class="vp-btn" id="vpLoopBtn" title="Loop (R)"><i class="fas fa-repeat"></i></button>
            <button class="vp-btn" id="vpCaptionsBtn" title="Captions (C)" style="display:none;"><i class="fas fa-closed-captioning"></i></button>

            <div class="vp-menu-wrap">
              <button class="vp-btn" id="vpQualityBtn" title="Quality" style="display:none;"><i class="fas fa-gauge-high"></i></button>
              <div class="vp-menu" id="vpQualityMenu">
                <div class="vp-menu-head"><i class="fas fa-gauge-high"></i> Quality</div>
                <div class="vp-menu-list" id="vpQualityList"></div>
              </div>
            </div>

            <div class="vp-speed-wrap">
              <button class="vp-speed-btn" id="vpSpeedBtn" title="Playback speed (&lt; / &gt;)">1x</button>
              <div class="vp-speed-menu" id="vpSpeedMenu"></div>
            </div>

            <button class="vp-btn" id="vpPipBtn" title="Picture-in-Picture (I)"><i class="fas fa-clone"></i></button>
            <button class="vp-btn" id="vpTheaterBtn" title="Theater mode (T)"><i class="fas fa-rectangle-wide"></i></button>
            <button class="vp-btn" id="vpFullscreenBtn" title="Fullscreen (F)"><i class="fas fa-expand"></i></button>
          </div>
        </div>

        <div class="vp-toast" id="vpToast"></div>
        <div class="vp-shortcuts" id="vpShortcuts">
          <div class="vp-shortcuts-card">
            <h5><i class="fas fa-keyboard"></i> Keyboard shortcuts</h5>
            <div class="vp-shortcuts-grid">
              <span><kbd>Space</kbd>/<kbd>K</kbd></span><span>Play / Pause</span>
              <span><kbd>←</kbd>/<kbd>→</kbd></span><span>Seek −5s / +5s</span>
              <span><kbd>J</kbd>/<kbd>L</kbd></span><span>Seek −10s / +10s</span>
              <span><kbd>↑</kbd>/<kbd>↓</kbd></span><span>Volume up / down</span>
              <span><kbd>0</kbd>–<kbd>9</kbd></span><span>Jump to 0% – 90%</span>
              <span><kbd>M</kbd></span><span>Mute</span>
              <span><kbd>F</kbd></span><span>Fullscreen</span>
              <span><kbd>T</kbd></span><span>Theater mode</span>
              <span><kbd>I</kbd></span><span>Picture-in-Picture</span>
              <span><kbd>&lt;</kbd>/<kbd>&gt;</kbd></span><span>Slower / Faster</span>
              <span><kbd>R</kbd></span><span>Toggle loop</span>
              <span><kbd>B</kbd></span><span>Save bookmark</span>
              <span><kbd>C</kbd></span><span>Toggle captions</span>
              <span><kbd>N</kbd>/<kbd>P</kbd></span><span>Next / Previous</span>
              <span><kbd>Esc</kbd></span><span>Close</span>
            </div>
            <p class="vp-shortcuts-hint">Click anywhere or press any key to dismiss</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this.modal = el;
    this.videoArea = el.querySelector('#vpVideoArea');
    this.titleEl = el.querySelector('#vpTitle');
    this.watermarkEl = el.querySelector('#vpWatermark');
    this.playlistPanel = el.querySelector('#vpPlaylistPanel');
    this.playlistItemsEl = el.querySelector('#vpPlaylistItems');

    this._bindControls();
  }

  _bindControls() {
    const $ = (s) => this.modal.querySelector(s);
    const click = (sel, fn) => {
      const el = $(sel);
      if (el) el.addEventListener('click', fn);
    };

    click('#vpBackBtn', () => this.close());
    click('#vpPlaylistClose', () => this._togglePlaylist(false));
    click('#vpPlaylistToggle', () => this._togglePlaylist());

    click('#vpPlayBtn', () => this._togglePlay());
    click('#vpPrevBtn', () => this._prevPlaylist());
    click('#vpNextBtn', () => this._nextPlaylist());
    click('#vpBack10Btn', () => this._seekBy(-10));
    click('#vpFwd10Btn', () => this._seekBy(10));
    click('#vpMuteBtn', () => this._toggleMute());
    click('#vpLoopBtn', () => this._toggleLoop());
    click('#vpCaptionsBtn', () => this._toggleCaptions());
    click('#vpPipBtn', () => this._togglePiP());
    click('#vpTheaterBtn', () => this._toggleTheater());
    click('#vpFullscreenBtn', () => this._toggleFullscreen());
    click('#vpBmBtn', (e) => { e.stopPropagation(); this._toggleMenu('#vpBookmarkMenu'); });
    click('#vpBmAddBtn', () => this._saveBookmark());
    click('#vpQualityBtn', (e) => { e.stopPropagation(); this._toggleMenu('#vpQualityMenu'); });
    click('#vpSpeedBtn', (e) => { e.stopPropagation(); this._toggleSpeedMenu(); });

    /* Video surface */
    const capture = this.modal.querySelector('#vpClickCapture');
    capture.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePlay();
      this._showControls();
      this._scheduleControlsHide();
    });
    capture.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._toggleFullscreen();
    });

    /* Volume slider */
    const vol = this.modal.querySelector('#vpVolumeRange');
    vol.addEventListener('input', () => {
      const v = parseInt(vol.value, 10) / 100;
      this._setVolume(v);
      if (v > 0 && this._isMuted()) this._setMuted(false);
    });

    /* Progress bar scrubbing */
    const row = this.modal.querySelector('#vpProgressRow');
    let scrubbing = false;
    const onScrub = (e) => {
      const rect = row.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this._seekTo(this.duration * pct);
      this._updateProgressUI(this.duration * pct);
    };
    const startScrub = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      scrubbing = true;
      e.preventDefault();
      onScrub(e);
      this.modal.querySelector('#vpProgressRow').classList.add('scrubbing');
    };
    const moveScrub = (e) => { if (scrubbing) onScrub(e); };
    const endScrub = () => {
      if (!scrubbing) return;
      scrubbing = false;
      this.modal.querySelector('#vpProgressRow').classList.remove('scrubbing');
    };
    row.addEventListener('mousedown', startScrub);
    document.addEventListener('mousemove', moveScrub);
    document.addEventListener('mouseup', endScrub);

    /* Hover preview */
    row.addEventListener('mousemove', (e) => {
      if (scrubbing) return;
      const rect = row.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const tt = this.modal.querySelector('#vpProgressTooltip');
      tt.style.left = (pct * 100) + '%';
      tt.textContent = this._fmt(this.duration * pct);
    });

    /* Close menus when clicking elsewhere */
    this.modal.addEventListener('click', () => {
      this._closeAllMenus();
      this._hideShortcuts();
    });
  }

  _bindGlobalEvents() {
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('mousemove', this._onMouseMove, { passive: true });
    this.modal.addEventListener('mouseleave', this._onMouseLeave);
    this._onFsChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const btn = this.modal && this.modal.querySelector('#vpFullscreenBtn i');
      if (btn) btn.className = isFs ? 'fas fa-compress' : 'fas fa-expand';
    };
    document.addEventListener('fullscreenchange', this._onFsChange);
    document.addEventListener('webkitfullscreenchange', this._onFsChange);
  }

  /* ------------------------------------------------------------
     Loading videos
     ------------------------------------------------------------ */
  async _loadSingle(opts) {
    this.titleEl.textContent = opts.title || 'Video';
    if (opts.videoId) {
      await this._createYouTubePlayer(opts.videoId);
    } else if (opts.src) {
      this._createDirectVideo(opts.src);
    } else {
      this.videoArea.insertAdjacentHTML('beforeend',
        '<div style="color:#fff;padding:24px;text-align:center;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">No video source provided.</div>');
    }
  }

  async _loadPlaylistItem(idx) {
    if (idx < 0 || idx >= this.playlist.length) return;
    /* Flush progress of the video we are leaving */
    if (this.materialId) this._reportProgress('switch');
    this.playlistIndex = idx;
    const item = this.playlist[idx];
    this.materialId = item.materialId || null;
    this.courseId = item.courseId || this.courseId;
    this._lastReportedPos = -1;
    this.titleEl.textContent = item.title || 'Video';
    this.videoId = item.videoId || item.materialId || item.title || ('item-' + idx);

    /* Clear previous player but keep overlay/watermark */
    if (this.ytPlayer) { try { this.ytPlayer.destroy(); } catch (e) {} this.ytPlayer = null; }
    if (this.videoEl) { try { this.videoEl.pause(); } catch (e) {} this.videoEl.remove(); this.videoEl = null; }
    const oldFrame = this.videoArea.querySelector('iframe');
    if (oldFrame) oldFrame.remove();

    if (item.kind === 'youtube' && item.videoId) {
      await this._createYouTubePlayer(item.videoId);
    } else if (item.kind === 'direct' && item.directUrl) {
      this._createDirectVideo(item.directUrl);
    }

    this._loadBookmarks();
    this._renderPlaylist();
  }

  /* ------------------------------------------------------------
     YouTube IFrame API
     ------------------------------------------------------------ */
  _loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (this._ytApiPromise) return this._ytApiPromise;

    this._ytApiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') try { prev(); } catch (e) {}
        resolve();
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => reject(new Error('Could not reach YouTube IFrame API'));
      document.head.appendChild(s);
    });
    return this._ytApiPromise;
  }

  async _createYouTubePlayer(videoId) {
    try {
      await this._loadYouTubeApi();
    } catch (e) {
      this._showError('YouTube is unreachable right now.');
      return;
    }

    /* A container div that YT replaces with the iframe */
    const containerId = 'vp-yt-' + Date.now();
    const holder = document.createElement('div');
    holder.id = containerId;
    holder.style.cssText = 'position:absolute;inset:0;';
    this.videoArea.insertBefore(holder, this.videoArea.firstChild);

    this.playerKind = 'youtube';
    this.ytReady = false;

    this.ytPlayer = new window.YT.Player(containerId, {
      host: 'https://www.youtube-nocookie.com',
      videoId,
      playerVars: {
        /* 🔒 The block-everything stack */
        controls: 0,          // no YouTube chrome at all
        disablekb: 1,         // we handle the keyboard
        fs: 0,                // no YT fullscreen button
        iv_load_policy: 3,    // no annotations
        modestbranding: 1,    // minimise branding
        rel: 0,               // no cross-channel related videos
        showinfo: 0,          // legacy but harmless
        cc_load_policy: 0,
        playsinline: 1,
        autoplay: 1,
        origin: window.location.origin,
        enablejsapi: 1,
        color: 'white'
      },
      events: {
        onReady: (e) => this._onYTReady(e),
        onStateChange: (e) => this._onYTStateChange(e),
        onError: (e) => this._onYTError(e)
      }
    });
  }

  _onYTReady(e) {
    this.ytReady = true;
    try {
      this.duration = this.ytPlayer.getDuration() || 0;
      this.ytPlayer.setVolume(Math.round(this.volume * 100));
      if (this.playbackRate !== 1) this.ytPlayer.setPlaybackRate(this.playbackRate);
      if (this.looping) this.ytPlayer.setLoop(true);
      this.ytPlayer.playVideo();
    } catch (err) {}

    this._maybeResumeFromSaved();
    this._renderQualityMenu();
    this._updatePlayButton();
    this._updateTimeDisplay();

    /* Show quality + captions controls only for YouTube */
    const q = this.modal.querySelector('#vpQualityBtn');
    const c = this.modal.querySelector('#vpCaptionsBtn');
    if (q) q.style.display = 'inline-flex';
    if (c) c.style.display = 'inline-flex';
  }

  _onYTStateChange(e) {
    const S = window.YT.PlayerState;
    this.isPlaying = (e.data === S.PLAYING);
    this.duration = this.ytPlayer.getDuration() || this.duration;
    this._updatePlayButton();

    if (e.data === S.ENDED) this._onVideoEnded();
    if (e.data === S.PLAYING) this._scheduleControlsHide();
  }

  _onYTError() {
    this._showError('This video could not be played.');
  }

  /* ------------------------------------------------------------
     Direct HTML5 video
     ------------------------------------------------------------ */
  _createDirectVideo(src) {
    this.playerKind = 'direct';
    const v = document.createElement('video');
    v.src = src;
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
    v.setAttribute('disablePictureInPicture', '');
    v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    this.videoArea.insertBefore(v, this.videoArea.firstChild);
    this.videoEl = v;

    v.addEventListener('loadedmetadata', () => {
      this.duration = v.duration || 0;
      this._updateTimeDisplay();
      this._maybeResumeFromSaved();
    });
    v.addEventListener('play', () => { this.isPlaying = true; this._updatePlayButton(); this._scheduleControlsHide(); });
    v.addEventListener('pause', () => { this.isPlaying = false; this._updatePlayButton(); });
    v.addEventListener('ended', () => this._onVideoEnded());
    v.addEventListener('timeupdate', () => this._updateProgressUI());
    v.addEventListener('progress', () => this._updateBuffered());
    v.addEventListener('volumechange', () => this._syncVolumeUI());
    v.addEventListener('ratechange', () => { this.playbackRate = v.playbackRate; this._updateSpeedUI(); });
  }

  /* ------------------------------------------------------------
     Abstraction layer
     ------------------------------------------------------------ */
  _getCurrentTime() {
    if (this.playerKind === 'youtube') return (this.ytPlayer && this.ytPlayer.getCurrentTime && this.ytPlayer.getCurrentTime()) || 0;
    return (this.videoEl && this.videoEl.currentTime) || 0;
  }
  _getDuration() {
    if (this.playerKind === 'youtube') return (this.ytPlayer && this.ytPlayer.getDuration && this.ytPlayer.getDuration()) || this.duration || 0;
    return (this.videoEl && this.videoEl.duration) || this.duration || 0;
  }
  _play() {
    if (this.playerKind === 'youtube' && this.ytPlayer) { try { this.ytPlayer.playVideo(); } catch (e) {} }
    else if (this.videoEl) { this.videoEl.play().catch(() => {}); }
  }
  _pause() {
    if (this.playerKind === 'youtube' && this.ytPlayer) { try { this.ytPlayer.pauseVideo(); } catch (e) {} }
    else if (this.videoEl) { this.videoEl.pause(); }
  }
  _togglePlay() { this.isPlaying ? this._pause() : this._play(); }
  _seekTo(sec) {
    sec = Math.max(0, Math.min(this._getDuration(), sec));
    if (this.playerKind === 'youtube' && this.ytPlayer) { try { this.ytPlayer.seekTo(sec, true); } catch (e) {} }
    else if (this.videoEl) { this.videoEl.currentTime = sec; }
  }
  _seekBy(d) { this._seekTo(this._getCurrentTime() + d); }

  _setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.playerKind === 'youtube' && this.ytPlayer) { try { this.ytPlayer.setVolume(Math.round(this.volume * 100)); } catch (e) {} }
    else if (this.videoEl) { this.videoEl.volume = this.volume; }
    this._syncVolumeUI();
  }
  _setMuted(m) {
    this.isMuted = !!m;
    if (this.playerKind === 'youtube' && this.ytPlayer) {
      try { this.isMuted ? this.ytPlayer.mute() : this.ytPlayer.unMute(); } catch (e) {}
    } else if (this.videoEl) { this.videoEl.muted = this.isMuted; }
    this._syncVolumeUI();
  }
  _isMuted() {
    if (this.playerKind === 'youtube' && this.ytPlayer && this.ytPlayer.isMuted) {
      try { return this.ytPlayer.isMuted(); } catch (e) {}
    }
    return this.isMuted;
  }
  _toggleMute() { this._setMuted(!this._isMuted()); }

  _setRate(r) {
    this.playbackRate = Math.max(0.25, Math.min(3, r));
    if (this.playerKind === 'youtube' && this.ytPlayer) { try { this.ytPlayer.setPlaybackRate(this.playbackRate); } catch (e) {} }
    else if (this.videoEl) { this.videoEl.playbackRate = this.playbackRate; }
    this._updateSpeedUI();
  }

  _toggleLoop() {
    this.looping = !this.looping;
    if (this.playerKind === 'youtube' && this.ytPlayer) { try { this.ytPlayer.setLoop(this.looping); } catch (e) {} }
    else if (this.videoEl) { this.videoEl.loop = this.looping; }
    const btn = this.modal.querySelector('#vpLoopBtn');
    if (btn) btn.classList.toggle('active', this.looping);
    this._showToast(this.looping ? 'Loop on' : 'Loop off');
  }

  _toggleCaptions() {
    if (this.playerKind !== 'youtube' || !this.ytPlayer) return;
    try {
      const cur = this.ytPlayer.getOptions ? this.ytPlayer.getOptions() : [];
      /* The IFrame API offers loadModule('captions').toggle() */
      const captions = this.ytPlayer.getOptions && this.ytPlayer.getOptions('captions');
      if (captions && captions.toggle) {
        captions.toggle();
        this.captionsOn = !this.captionsOn;
        const btn = this.modal.querySelector('#vpCaptionsBtn');
        btn.classList.toggle('active', this.captionsOn);
      } else {
        this._showToast('Captions not available for this video');
      }
    } catch (e) {}
  }

  _getBufferedFraction() {
    if (this.playerKind === 'youtube' && this.ytPlayer && this.ytPlayer.getVideoLoadedFraction) {
      try { return this.ytPlayer.getVideoLoadedFraction() || 0; } catch (e) { return 0; }
    }
    if (this.videoEl && this.videoEl.buffered && this.videoEl.duration) {
      const b = this.videoEl.buffered;
      if (b.length > 0) return b.end(b.length - 1) / this.videoEl.duration;
    }
    return 0;
  }

  /* ------------------------------------------------------------
     Tick loop
     ------------------------------------------------------------ */
  _startTick() {
    this._stopTick();
    const loop = () => {
      if (!this.active) return;
      this._tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  _stopTick() { if (this.rafId) cancelAnimationFrame(this.rafId); this.rafId = null; }

  _tick() {
    this._updateProgressUI();
    this._updateTimeDisplay();
    /* Save resume position every ~5 s */
    const now = Date.now();
    if (!this._lastResumeSave || now - this._lastResumeSave > 5000) {
      this._lastResumeSave = now;
      this._saveResume();
    }
    /* ⭐ Sync watch progress to the server every ~15 s while playing */
    if (this.isPlaying && now - (this._lastReportAt || 0) > 15000) {
      this._reportProgress('tick');
    }
  }

  /* ------------------------------------------------------------
     UI updates
     ------------------------------------------------------------ */
  _updatePlayButton() {
    const btn = this.modal && this.modal.querySelector('#vpPlayBtn i');
    if (btn) btn.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
    const big = this.modal && this.modal.querySelector('#vpBigPlay');
    if (big) big.classList.toggle('visible', !this.isPlaying);
  }

  _updateProgressUI(overrideTime) {
    const now = (typeof overrideTime === 'number') ? overrideTime : this._getCurrentTime();
    const dur = this._getDuration() || 1;
    const pct = Math.max(0, Math.min(1, now / dur)) * 100;

    const filled = this.modal && this.modal.querySelector('#vpProgressFilled');
    const thumb  = this.modal && this.modal.querySelector('#vpProgressThumb');
    if (filled) filled.style.width = pct + '%';
    if (thumb)  thumb.style.left  = pct + '%';
  }

  _updateBuffered() {
    const pct = this._getBufferedFraction() * 100;
    const el = this.modal && this.modal.querySelector('#vpProgressBuffered');
    if (el) el.style.width = pct + '%';
  }

  _updateTimeDisplay() {
    const el = this.modal && this.modal.querySelector('#vpTime');
    if (!el) return;
    el.textContent = this._fmt(this._getCurrentTime()) + ' / ' + this._fmt(this._getDuration());
  }

  _syncVolumeUI() {
    const slider = this.modal && this.modal.querySelector('#vpVolumeRange');
    const icon = this.modal && this.modal.querySelector('#vpMuteBtn i');
    const muted = this._isMuted();
    const v = this.volume;
    if (slider) slider.value = muted ? 0 : Math.round(v * 100);
    if (icon) {
      icon.className = muted || v === 0 ? 'fas fa-volume-xmark'
                    : v < 0.33        ? 'fas fa-volume-low'
                    : v < 0.66        ? 'fas fa-volume-low'
                    :                   'fas fa-volume-high';
    }
  }

  _updateSpeedUI() {
    const btn = this.modal && this.modal.querySelector('#vpSpeedBtn');
    if (btn) btn.textContent = this.playbackRate + 'x';
    const menu = this.modal && this.modal.querySelector('#vpSpeedMenu');
    if (menu) {
      menu.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.rate) === this.playbackRate);
      });
    }
  }

  /* ------------------------------------------------------------
     Controls visibility
     ------------------------------------------------------------ */
  _showControls() {
    if (!this.modal) return;
    this.modal.querySelector('#vpControls').classList.remove('hidden');
    this.modal.querySelector('#vpTitle').classList.remove('hidden');
    this.controlsVisible = true;
  }
  _hideControls() {
    if (!this.modal) return;
    if (!this.isPlaying) return;   // keep controls visible while paused
    this.modal.querySelector('#vpControls').classList.add('hidden');
    this.modal.querySelector('#vpTitle').classList.add('hidden');
    this.controlsVisible = false;
    this._closeAllMenus();
  }
  _scheduleControlsHide() {
    clearTimeout(this.controlsTimer);
    this._showControls();
    if (this.isPlaying) {
      this.controlsTimer = setTimeout(() => this._hideControls(), 3000);
    }
  }
  _onMouseMove() { if (this.active) this._scheduleControlsHide(); }
  _onMouseLeave() { if (this.active && this.isPlaying) this._hideControls(); }

  /* ------------------------------------------------------------
     Menus
     ------------------------------------------------------------ */
  _closeAllMenus() {
    this.modal && this.modal.querySelectorAll('.vp-menu, .vp-speed-menu, .vp-shortcuts').forEach(m => m.classList.remove('open'));
  }
  _toggleMenu(sel) {
    const el = this.modal && this.modal.querySelector(sel);
    if (!el) return;
    const wasOpen = el.classList.contains('open');
    this._closeAllMenus();
    if (!wasOpen) el.classList.add('open');
  }
  _toggleSpeedMenu() {
    const el = this.modal && this.modal.querySelector('#vpSpeedMenu');
    if (!el) return;
    const wasOpen = el.classList.contains('open');
    this._closeAllMenus();
    if (!wasOpen) el.classList.add('open');
  }
  _showShortcuts() {
    const el = this.modal && this.modal.querySelector('#vpShortcuts');
    if (el) el.classList.add('open');
  }
  _hideShortcuts() {
    const el = this.modal && this.modal.querySelector('#vpShortcuts');
    if (el) el.classList.remove('open');
  }

  _renderSpeedMenu() {
    const el = this.modal && this.modal.querySelector('#vpSpeedMenu');
    if (!el) return;
    const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    el.innerHTML = rates.map(r =>
      `<button data-rate="${r}"${r === this.playbackRate ? ' class="active"' : ''}>${r}x${r === 1 ? ' (normal)' : ''}</button>`
    ).join('');
    el.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setRate(parseFloat(b.dataset.rate));
        this._closeAllMenus();
        this._showToast('Speed: ' + this.playbackRate + 'x');
      });
    });
  }

  _renderQualityMenu() {
    if (this.playerKind !== 'youtube' || !this.ytPlayer) return;
    const el = this.modal && this.modal.querySelector('#vpQualityList');
    if (!el) return;
    let levels = [];
    try { levels = this.ytPlayer.getAvailableQualityLevels() || []; } catch (e) {}

    const labels = {
      highres:  '4320p (8K)',
      hd2160:   '2160p (4K)',
      hd1440:   '1440p',
      hd1080:   '1080p',
      hd720:    '720p',
      large:    '480p',
      medium:   '360p',
      small:    '240p',
      tiny:     '144p',
      auto:     'Auto'
    };

    const items = ['auto', ...levels.filter(l => l !== 'auto')];
    el.innerHTML = items.map(q =>
      `<button data-q="${q}">${labels[q] || q}</button>`
    ).join('');

    el.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        try { this.ytPlayer.setPlaybackQuality(b.dataset.q); } catch (err) {}
        el.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._closeAllMenus();
        this._showToast('Quality: ' + (labels[b.dataset.q] || b.dataset.q));
      });
    });
  }

  /* ------------------------------------------------------------
     Playlist
     ------------------------------------------------------------ */
  _togglePlaylist(forceState) {
    if (!this.playlistPanel) return;
    const isOpen = typeof forceState === 'boolean'
      ? forceState
      : !this.playlistPanel.classList.contains('open');
    this.playlistPanel.classList.toggle('open', isOpen);
    this.modal.querySelector('.vp-shell').classList.toggle('playlist-open', isOpen);
  }

  _renderPlaylist() {
    if (!this.playlistItemsEl) return;
    const VP = window.AeroVideoProgress;
    this.playlistItemsEl.innerHTML = this.playlist.map((item, i) => {
      const pr = (VP && item.materialId) ? VP.get(item.materialId) : null;
      const pct = pr ? Math.max(0, Math.min(100, pr.pct || 0)) : 0;
      const done = !!(pr && pr.completed);
      return `
      <div class="vp-playlist-item ${i === this.playlistIndex ? 'current' : ''} ${done ? 'watched' : ''}" data-index="${i}">
        <div class="vp-playlist-item-num">${done ? '<i class="fas fa-check" aria-label="Watched"></i>' : (i + 1)}</div>
        <div class="vp-playlist-item-title">${_escHtml(item.title)}
          ${pct > 0 ? `<span class="vp-pl-progress" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}
        </div>
        ${i === this.playlistIndex ? '<i class="fas fa-volume-up vp-playlist-item-playing"></i>' : ''}
      </div>`;
    }).join('');
    this.playlistItemsEl.querySelectorAll('.vp-playlist-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        if (idx !== this.playlistIndex) this._loadPlaylistItem(idx);
      });
    });
  }

  _nextPlaylist() {
    if (this.playlist.length === 0) return;
    const next = (this.playlistIndex + 1) % this.playlist.length;
    this._loadPlaylistItem(next);
  }
  _prevPlaylist() {
    if (this.playlist.length === 0) return;
    const prev = (this.playlistIndex - 1 + this.playlist.length) % this.playlist.length;
    this._loadPlaylistItem(prev);
  }

  _onVideoEnded() {
    this._reportProgress('ended', true);
    if (this.looping) { this._play(); return; }
    if (this.playlist.length > 1 && this.playlistIndex < this.playlist.length - 1) {
      this._showToast('Next up: ' + (this.playlist[this.playlistIndex + 1].title || ''));
      setTimeout(() => this._loadPlaylistItem(this.playlistIndex + 1), 800);
    }
  }

  /* ------------------------------------------------------------
     Bookmarks
     ------------------------------------------------------------ */
  _bmKey() { return 'aero_vp_bm_' + this.videoId; }
  _loadBookmarks() {
    try {
      const raw = localStorage.getItem(this._bmKey());
      this.bookmarks = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.bookmarks)) this.bookmarks = [];
    } catch (e) { this.bookmarks = []; }
    this._renderBookmarkMenu();
  }
  _saveBookmarks() {
    try { localStorage.setItem(this._bmKey(), JSON.stringify(this.bookmarks)); } catch (e) {}
    this._renderBookmarkMenu();
  }
  _saveBookmark() {
    const t = this._getCurrentTime();
    if (!t || t < 1) { this._showToast('Cannot bookmark at 0:00'); return; }
    const label = prompt('Label for this bookmark (optional):', 'Bookmark at ' + this._fmt(t));
    if (label === null) return;
    this.bookmarks.push({ t, label: label || this._fmt(t), created: Date.now() });
    this.bookmarks.sort((a, b) => a.t - b.t);
    this._saveBookmarks();
    this._showToast('Bookmark saved at ' + this._fmt(t));
    this._closeAllMenus();
  }
  _deleteBookmark(idx) {
    this.bookmarks.splice(idx, 1);
    this._saveBookmarks();
  }
  _renderBookmarkMenu() {
    const el = this.modal && this.modal.querySelector('#vpBookmarkList');
    if (!el) return;
    if (this.bookmarks.length === 0) {
      el.innerHTML = '<div class="vp-menu-empty">No bookmarks yet</div>';
      return;
    }
    el.innerHTML = this.bookmarks.map((b, i) => `
      <div class="vp-bookmark-item" data-idx="${i}">
        <button class="vp-bookmark-jump" data-t="${b.t}">
          <i class="fas fa-play"></i> <span class="vp-bookmark-time">${this._fmt(b.t)}</span>
          <span class="vp-bookmark-label">${_escHtml(b.label)}</span>
        </button>
        <button class="vp-bookmark-del" title="Delete"><i class="fas fa-times"></i></button>
      </div>`).join('');

    el.querySelectorAll('.vp-bookmark-jump').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._seekTo(parseFloat(btn.dataset.t));
        this._play();
        this._closeAllMenus();
      });
    });
    el.querySelectorAll('.vp-bookmark-del').forEach((btn, i) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteBookmark(i);
      });
    });
  }

  /* ------------------------------------------------------------
     Resume
     ------------------------------------------------------------ */
  _resumeKey() { return 'aero_vp_pos_' + this.videoId; }
  _saveResume() {
    const t = this._getCurrentTime();
    const dur = this._getDuration();
    if (!t || t < 5 || !dur || dur < 30) return;
    if (t > dur - 15) { try { localStorage.removeItem(this._resumeKey()); } catch (e) {} return; }
    try {
      localStorage.setItem(this._resumeKey(), JSON.stringify({ t, dur, at: Date.now() }));
    } catch (e) {}
  }
  /* ⭐ Watch-progress reporting. The player stays decoupled from the
     network: it fires a DOM event and app.js persists it. */
  _reportProgress(reason, ended) {
    try {
      if (!this.materialId) return;
      const t = this._getCurrentTime();
      const d = this._getDuration();
      if (!d || d < 1) return;
      if (!ended && reason === 'tick' && Math.abs(t - this._lastReportedPos) < 4) return;
      if (!ended && t < 1 && reason !== 'tick') return;
      this._lastReportedPos = t;
      this._lastReportAt = Date.now();
      window.dispatchEvent(new CustomEvent('aero:video-progress', {
        detail: {
          courseId: this.courseId, materialId: this.materialId,
          position: ended ? d : t, duration: d, ended: !!ended, reason
        }
      }));
      if (reason !== 'close') this._renderPlaylist();
    } catch (e) { /* never break playback */ }
  }

  _maybeResumeFromSaved() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(this._resumeKey())); } catch (e) {}
    /* ⭐ Fall back to the server-side position (another device / cleared storage) */
    if ((!saved || !saved.t) && this.materialId && window.AeroVideoProgress) {
      const srv = window.AeroVideoProgress.get(this.materialId);
      if (srv && !srv.completed && srv.pos >= 10) {
        saved = { t: srv.pos, dur: srv.dur, at: srv.updatedAt ? new Date(srv.updatedAt).getTime() : Date.now() };
      }
    }
    if (!saved || !saved.t || saved.t < 10) return;
    const dur = this._getDuration();
    if (dur && saved.t > dur - 15) return;
    /* Only offer if the save is fresh (< 30 days) */
    if (saved.at && Date.now() - saved.at > 30 * 86400000) return;

    this._resumePos = saved.t;
    this._seekTo(saved.t);
    this._showToast('📖 Resuming from ' + this._fmt(saved.t));
  }

  /* ------------------------------------------------------------
     Fullscreen / theater / PiP
     ------------------------------------------------------------ */
  _toggleFullscreen() {
    const shell = this.modal.querySelector('.vp-shell');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    } else {
      const req = shell.requestFullscreen || shell.webkitRequestFullscreen || shell.msRequestFullscreen;
      if (req) req.call(shell).catch(() => {});
    }
  }

  _toggleTheater() {
    this.theater = !this.theater;
    this.modal.querySelector('.vp-shell').classList.toggle('vp-theater', this.theater);
    this.modal.querySelector('#vpTheaterBtn').classList.toggle('active', this.theater);
    this._showToast(this.theater ? 'Theater mode on' : 'Theater mode off');
  }

  async _togglePiP() {
    try {
      if (this.videoEl && document.pictureInPictureEnabled) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await this.videoEl.requestPictureInPicture();
        }
      } else {
        this._showToast('Picture-in-Picture is not available for YouTube videos');
      }
    } catch (e) {
      this._showToast('Picture-in-Picture failed: ' + (e.message || ''));
    }
  }

  /* ------------------------------------------------------------
     Keyboard
     ------------------------------------------------------------ */
  _onKeyDown(e) {
    if (!this.active) return;

    /* Ignore modifier-only or browser shortcuts */
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (e.shiftKey && e.key === '/') {
        e.preventDefault();
        this._showShortcuts();
      }
      return;
    }

    const inField = e.target && e.target.matches && e.target.matches('input, textarea, [contenteditable="true"]');
    const key = e.key;

    /* Screenshot protection (kept from v5) */
    if (key === 'PrintScreen' || e.keyCode === 44) {
      e.preventDefault();
      try { navigator.clipboard.writeText('Screenshots disabled.'); } catch (_) {}
      this._flashBlur();   // shield shows the warning — no second toast
      return;
    }

    if (key === '?' || (e.shiftKey && key === '/')) {
      e.preventDefault();
      this._showShortcuts();
      return;
    }

    if (inField) return;

    /* Dismiss shortcuts on any key */
    this._hideShortcuts();
    this._scheduleControlsHide();

    switch (key) {
      case ' ': case 'k': case 'K':
        e.preventDefault(); this._togglePlay(); break;

      case 'ArrowLeft':  e.preventDefault(); this._seekBy(-5); this._showToast('⏪ 5s'); break;
      case 'ArrowRight': e.preventDefault(); this._seekBy(5);  this._showToast('⏩ 5s'); break;
      case 'j': case 'J': e.preventDefault(); this._seekBy(-10); this._showToast('⏪ 10s'); break;
      case 'l': case 'L': e.preventDefault(); this._seekBy(10);  this._showToast('⏩ 10s'); break;

      case 'ArrowUp':   e.preventDefault(); this._setVolume(this.volume + 0.05); this._showToast('Volume ' + Math.round(this.volume * 100) + '%'); break;
      case 'ArrowDown': e.preventDefault(); this._setVolume(this.volume - 0.05); this._showToast('Volume ' + Math.round(this.volume * 100) + '%'); break;

      case 'm': case 'M': e.preventDefault(); this._toggleMute(); this._showToast(this._isMuted() ? 'Muted' : 'Unmuted'); break;

      case 'f': case 'F': e.preventDefault(); this._toggleFullscreen(); break;
      case 't': case 'T': e.preventDefault(); this._toggleTheater(); break;
      case 'i': case 'I': e.preventDefault(); this._togglePiP(); break;
      case 'r': case 'R': e.preventDefault(); this._toggleLoop(); break;
      case 'b': case 'B': e.preventDefault(); this._saveBookmark(); break;
      case 'c': case 'C': e.preventDefault(); this._toggleCaptions(); break;
      case 'n': case 'N': e.preventDefault(); this._nextPlaylist(); break;
      case 'p': case 'P': e.preventDefault(); this._prevPlaylist(); break;

      case '<': case ',': e.preventDefault(); this._setRate(this.playbackRate - 0.25); this._showToast('Speed: ' + this.playbackRate + 'x'); break;
      case '>': case '.': e.preventDefault(); this._setRate(this.playbackRate + 0.25); this._showToast('Speed: ' + this.playbackRate + 'x'); break;

      case 'Escape':
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          e.preventDefault();
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          e.preventDefault();
          this.close();
        }
        break;

      default:
        if (/^[0-9]$/.test(key)) {
          e.preventDefault();
          const pct = parseInt(key, 10) / 10;
          this._seekTo(this._getDuration() * pct);
          this._showToast('→ ' + (pct * 100) + '%');
        }
        break;
    }
  }

  /* ------------------------------------------------------------
     Watermark, protection, helpers
     ------------------------------------------------------------ */
  /* 2026-10-04: visible watermarks removed site-wide (owner's decision).
     Tracking now happens invisibly on the server (access log). */
  _renderWatermark() { /* intentionally no-op */ }

  _flashBlur() {
    if (!this.modal) return;
    const shell = this.modal.querySelector('.vp-shell');
    if (!shell) return;
    shell.style.transition = 'filter .1s';
    shell.style.filter = 'blur(28px) grayscale(100%)';
    setTimeout(() => { if (shell) shell.style.filter = ''; }, 1800);
  }

  _fmt(sec) {
    if (!sec || sec < 0 || !isFinite(sec)) return '0:00';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
      : `${m}:${String(ss).padStart(2,'0')}`;
  }

  _showToast(msg) {
    const el = this.modal && this.modal.querySelector('#vpToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  _showError(msg) {
    if (!this.videoArea) return;
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;background:rgba(0,0,0,.65);z-index:6;padding:24px;text-align:center;';
    div.innerHTML = `<i class="fas fa-triangle-exclamation" style="font-size:36px;color:#f59e0b;margin-bottom:14px;"></i><p style="margin:0 0 8px;font-size:15px;">${_escHtml(msg)}</p><p style="margin:0;font-size:12.5px;color:#9ca3af;">Try a different video or contact support.</p>`;
    this.videoArea.appendChild(div);
  }
}

  window.VideoPlayer = new VideoPlayer();

  /* ============================================================
     PDF VIEWER — with hardened capture deterrence
     ============================================================ */
  class PDFViewer {
    constructor() { this._init(); }

    _init() {
      this.active = false;
      this.modal = null;
      this.bodyEl = null;
      this.pagesEl = null;
      this.selMenu = null;
      this.loaderEl = null;
      this.pdfDoc = null;
      this.materialId = null;
      this.scale = 1.2;
      this.color = 'yellow';
      this.highlights = [];
      this.pageEls = new Map();
      this.textLayers = new Map();
      this.pendingSel = null;
      this.currentPage = 1;
      this.username = '';
      this.title = '';
      this._prevBodyOverflow = '';
      this._selTimer = null;
      this._blurTimer = null;
      /* ⭐ Premium-access fields — must be reset between opens so a
         previous session's state can never leak into the next PDF. */
      this.courseId       = null;
      this.hasFullAccess  = false;
      this.previewPercent = 0;
      this.lockReason     = null;
      /* ⭐ Reading-progress state */
      this._resumePage = 1;              // saved page to jump to on open
      this._saveProgressTimer = null;    // debounce handle for saves
      this._resumeApplied = false;       // guard: only scroll once per open
      this._paywallObserver = null;      // ⭐ scroll-triggered paywall observer

      this._onSelectionChange = this._onSelectionChange.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onBodyScroll = this._onBodyScroll.bind(this);
      this._onWindowBlur = this._onWindowBlur.bind(this);
      this._onWindowFocus = this._onWindowFocus.bind(this);
      this._onVisibility = this._onVisibility.bind(this);
      this._onPageHide = this._onPageHide.bind(this);   // ⭐ new
    }
    async open(opts) {
      if (this.active) return;
      this.active = true;

      if (!window.pdfjsLib) {
        this.active = false;
        userToast('PDF engine not loaded. Please refresh.', 'error');
        return;
      }
      try {
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          /* Same-origin worker — see index.html loadPDFJS().
             Kept here as a defensive fallback in case the viewer
             is somehow opened before that file has run. */
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
        }
      } catch (e) {}

      this.materialId = opts.materialId || 'doc';
      this.username   = opts.username || 'Student';
      this.title      = opts.title || opts.fileName || 'Document';
      this._prevBodyOverflow = document.body.style.overflow;

      /* ⭐ CRITICAL — Premium-access fields.
         ------------------------------------------------------------
         app.js viewFileOnline() passes THREE extra fields that the
         paywall logic in _renderAllPages() depends on:

             opts.courseId        → used by _onPaywallClick()
             opts.hasFullAccess   → decides if ANY page is locked
             opts.previewPercent  → decides how many pages are free

         All three were previously IGNORED — this method never
         copied them onto `this`. As a result:

           • this.hasFullAccess  was always undefined (falsy)
           • this.previewPercent was always undefined (falsy)
           • renderLimit always resolved to 0
           • EVERY paid student saw "All pages require purchase"
           • Even a document configured with 20 % free preview
             rendered as a fully-locked document.
           • The "Unlock the full document" button closed the viewer
             but never opened the payment modal, because this.courseId
             was also never set.

         Assigning them here restores:
           ✓ preview pages actually render
           ✓ the correct "You can read the first N of M pages" card
           ✓ the Unlock button opens showPaymentModal()
           ✓ fully-paid users get every page. */
      this.courseId       = opts.courseId || null;
      this.hasFullAccess  = opts.hasFullAccess === true;
      this.previewPercent = Math.max(
        0,
        Math.min(100, Number(opts.previewPercent) || 0)
      );
      /* ⭐ NEW — used by the blank paywall card and the CTA
         handler to show the correct message and route the user
         to either login or the payment modal. */
      this.lockReason     = opts.lockReason || null;
      /* ⭐ 'slides' = rendered PowerPoint → fit whole slide, highlight Present */
      this.viewMode       = opts.mode === 'slides' ? 'slides' : 'document';

      this._buildUI();
      if (this.viewMode === 'slides') this.modal.classList.add('pdfv-slides-mode');
      this._loadHighlights();
      this._renderWatermark();

      this.modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      this._setLoaderText('Loading document…');
      this.loaderEl.style.display = 'flex';

      try {
        let source;
        if (opts.url) {
          source = await this._buildPdfSource(opts.url);
        } else {
          const dataURL = String(opts.data || '').indexOf('data:') === 0
            ? opts.data
            : 'data:application/pdf;base64,' + opts.data;
          /* ⚠️ dataURLToBytes() is async (it prefers the browser's
             native fetch-based base64 decoder). The previous code
             did not await it, so PDF.js received a Promise instead
             of a Uint8Array and every base64/legacy-fallback PDF
             failed to render. */
          const bytes = await dataURLToBytes(dataURL);
          source = { data: bytes };
        }

        if (!this.active) return;

        this._setLoaderText('Rendering pages…');
        this.pdfDoc = await pdfjsLib.getDocument(source).promise;
        if (!this.active) return;

        /* Slides: pick the "whole slide fits the screen" zoom BEFORE the
           first layout, so pages are laid out once at the right size
           (re-zooming straight after the first pass left oversized blank
           placeholders and duplicated slides on phones). */
        if (this.viewMode === 'slides') {
          try {
            const p1 = await this.pdfDoc.getPage(1);
            const vp = p1.getViewport({ scale: 1 });
            const fit = Math.min((this.bodyEl.clientWidth - 60) / vp.width,
                                 (this.bodyEl.clientHeight - 60) / vp.height);
            if (isFinite(fit) && fit > 0) {
              this.scale = Math.max(0.4, Math.min(3.5, fit));
              this._updateZoomLabel();
            }
          } catch (e) { /* keep default zoom */ }
          if (!this.active) return;
        }

        await this._renderAllPages();
        this.loaderEl.style.display = 'none';
        if (this.viewMode === 'slides') {
          userToast('Tip: press P (or the Present button) for a full-screen slideshow.', 'info');
        }
      } catch (err) {
        console.error('[PDFViewer]', err);
        if (this.loaderEl) {
          this.loaderEl.innerHTML =
            '<div class="pdfv-error">' +
              '<i class="fas fa-exclamation-triangle"></i>' +
              '<p>Could not load this document.</p>' +
              '<button type="button" class="btn btn-outline btn-sm" onclick="window.PDFViewer.close()">Close</button>' +
            '</div>';
        }
      }
    }

    /* ---------- Loader message helper ---------- */
    _setLoaderText(msg) {
      if (!this.loaderEl) return;
      const p = this.loaderEl.querySelector('p');
      if (p) p.textContent = msg;
    }

    /* ============================================================
       Smart PDF source loader
       ------------------------------------------------------------
       PDF.js normally fetches a PDF via dozens of small HTTP Range
       requests (default chunk = 64 KB). On a high-latency campus
       proxy, every one of those is a full round trip — a 5 MB PDF
       can take 10-20 seconds even on fast Wi-Fi.

       Strategy:
         1. HEAD the URL → learn size + range support.
         2. ≤ 25 MB  → fetch in ONE request as ArrayBuffer. One RTT
                       total, with a streaming progress readout.
         3. > 25 MB  → stream via PDF.js with a 1 MB range chunk
                       (16× fewer requests than default).
         4. On error → plain URL fallback so the viewer never breaks.
       ============================================================ */
        /* ============================================================
       Smart PDF source loader — v2
       ------------------------------------------------------------
       WHY THIS WAS REWRITTEN
       ----------------------
       The previous version tried a HEAD probe first, and fell back
       to Range-request streaming whenever:
         • the HEAD request itself failed, OR
         • the server did not return a Content-Length header, OR
         • the response advertised Accept-Ranges: bytes.

       On mobile data that was fine. On a campus / corporate proxy
       it was catastrophic: every PDF.js Range request (default
       chunk = 64 KB) has to traverse the proxy, and the proxy adds
       150–400 ms per round trip. A 5 MB PDF = ~78 requests = 15–30
       seconds of pure latency, while the same file downloads in
       under a second on mobile data with no proxy in the way.

       NEW STRATEGY
       ------------
         1. Probe size with HEAD (best-effort — failures are OK).
         2. Anything under 60 MB → download in ONE request and hand
            the complete ArrayBuffer to PDF.js. PDF.js then makes
            ZERO further HTTP requests.
         3. Only a genuinely huge PDF (> 60 MB) still streams with
            an enlarged 1 MB chunk size.
         4. If the single-shot GET itself fails, fall back to the
            old streaming path as a last resort.
       ============================================================ */
       /* ============================================================
       Smart PDF source loader — v3 (campus-network optimised)
       ------------------------------------------------------------
       KEY CHANGES vs v2:

         • HEAD probe REMOVED. Every HEAD costs a full round trip
           (~150-400 ms on a campus proxy) before the download
           even begins. We now go straight for the GET and read
           Content-Length from the response headers.

         • Bigger range chunk (4 MB instead of 1 MB) for the
           fallback streaming path. Halves the number of Range
           requests on huge PDFs.

         • `priority: 'high'` on the fetch tells Chrome/Edge/Safari
           to schedule it sooner, ahead of background prefetches.

         • Loader text updates THROTTLED to 4× per second. The
           old version ran `_setLoaderText()` on every ~32 KB
           chunk — 150+ DOM writes for a 5 MB PDF — which starved
           the main thread and blocked PDF.js from rendering.
       ============================================================ */
    async _buildPdfSource(url) {
      /* ------------------------------------------------------------
         Two-tier strategy.

         TIER 1 — Range streaming (default for anything over ~1.5 MB).
           PDF.js issues "Range: bytes=N-M" requests and renders
           page 1 as soon as the first chunk arrives. On a campus
           proxy this is the difference between "wait 40 seconds for
           the download bar" and "page 1 appears in 3 seconds".

         TIER 2 — Single-shot buffered download (tiny files only).
           Below ~1.5 MB, buffering in one request is genuinely
           faster because PDF.js doesn't have to open a second
           connection for the range chunks.
         ------------------------------------------------------------ */

      const SMALL_PDF_THRESHOLD = 1.5 * 1024 * 1024;   // 1.5 MB
      const RANGE_CHUNK         = 2 * 1024 * 1024;     // 2 MB

      /* Single GET — no HEAD probe (an extra round trip we don't need). */
      let res;
      try {
        res = await fetch(url, {
          credentials: 'same-origin',
          cache: 'default',
          priority: 'high'
        });
      } catch (e) {
        console.warn('[PDFViewer] fetch failed, streaming fallback:', e.message);
        return { url, rangeChunkSize: RANGE_CHUNK };
      }

      if (!res.ok) {
        console.warn('[PDFViewer] HTTP', res.status, '— streaming fallback');
        return { url, rangeChunkSize: RANGE_CHUNK };
      }

      const len = parseInt(res.headers.get('content-length') || '0', 10);
      const acceptsRanges = (res.headers.get('accept-ranges') || '')
                              .toLowerCase()
                              .includes('bytes');

      /* TIER 1 — range streaming path.
         A missing Content-Length (some proxies strip it) is NOT a
         reason to skip streaming — Range still works, we just can't
         show a percentage in the loader. */
      if (acceptsRanges && (len === 0 || len > SMALL_PDF_THRESHOLD)) {
        try { if (res.body && res.body.cancel) res.body.cancel(); } catch (_) {}
        console.log(
          '[PDFViewer] Streaming ' +
          (len ? (len / 1048576).toFixed(1) + ' MB' : '(unknown size)') +
          ' with ' + (RANGE_CHUNK / 1048576) + ' MB chunks'
        );
        return { url, rangeChunkSize: RANGE_CHUNK };
      }

      /* TIER 2 — small file, buffer in one shot. */
      if (res.body && typeof res.body.getReader === 'function') {
        const reader  = res.body.getReader();
        const chunks  = [];
        let received  = 0;
        let lastTick  = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;

          /* Throttle the UI update to 4× / second max — the old
             version ran this on every ~32 KB chunk and starved the
             main thread. */
          const now = Date.now();
          if (now - lastTick > 250) {
            lastTick = now;
            const label = len > 0
              ? 'Downloading document… ' +
                Math.min(100, Math.round((received / len) * 100)) + '%'
              : 'Downloading document… ' +
                (received / 1048576).toFixed(1) + ' MB';
            this._setLoaderText(label);
          }
        }

        const merged = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }

        console.log(
          '[PDFViewer] Buffered small PDF (' +
          (received / 1048576).toFixed(2) + ' MB)'
        );
        return { data: merged };
      }

      /* Last resort — one big buffer. */
      const buf = await res.arrayBuffer();
      console.log(
        '[PDFViewer] Buffered PDF (' +
        (buf.byteLength / 1048576).toFixed(2) + ' MB)'
      );
      return { data: new Uint8Array(buf) };
    }
    _buildUI() {
      const old = document.getElementById('pdfViewerModal');
      if (old) old.remove();

      const el = document.createElement('div');
      el.id = 'pdfViewerModal';
      el.className = 'pdf-viewer-modal';

      const colorBtns = Object.keys(HL_COLORS).map(c =>
        '<button class="pdfv-color ' + c + '" data-color="' + c +
        '" title="' + (HL_COLOR_LABELS[c] || c) + '" aria-label="Highlight ' +
        (HL_COLOR_LABELS[c] || c) + '" type="button"></button>'
      ).join('');

      el.innerHTML =
        '<div class="pdfv-shell" oncontextmenu="return false;">' +
          '<div class="pdfv-progress" id="pdfvProgress"></div>' +
          '<div class="pdfv-toolbar">' +
            '<div class="pdfv-toolbar-left">' +
              '<button type="button" class="pdfv-back-btn" data-act="close" title="Back (Esc)">' +
                '<i class="fas fa-arrow-left"></i><span>Back</span>' +
              '</button>' +
              '<span class="pdfv-title" id="pdfvTitle"></span>' +
              '<span class="pdfv-hlcount" id="pdfvHlCount"></span>' +
            '</div>' +
            '<div class="pdfv-toolbar-center">' +
              '<button type="button" class="pdfv-btn" data-act="prev" title="Previous page"><i class="fas fa-chevron-up"></i></button>' +
              '<span class="pdfv-pageinfo">' +
                '<input type="number" id="pdfvPageInput" min="1" value="1">' +
                '<span>/</span><span id="pdfvPageCount">1</span>' +
              '</span>' +
              '<button type="button" class="pdfv-btn" data-act="next" title="Next page"><i class="fas fa-chevron-down"></i></button>' +
              '<span class="pdfv-divider"></span>' +
              '<button type="button" class="pdfv-btn" data-act="zoomout" title="Zoom out"><i class="fas fa-search-minus"></i></button>' +
              '<span class="pdfv-zoomlabel" id="pdfvZoomLabel">100%</span>' +
              '<button type="button" class="pdfv-btn" data-act="zoomin" title="Zoom in"><i class="fas fa-search-plus"></i></button>' +
              '<button type="button" class="pdfv-btn" data-act="fit" title="Fit to width (W)"><i class="fas fa-arrows-alt-h"></i></button>' +
              '<button type="button" class="pdfv-btn" data-act="fitpage" title="Fit whole page (F)"><i class="fas fa-expand"></i></button>' +
              '<span class="pdfv-divider"></span>' +
              '<button type="button" class="pdfv-btn pdfv-present-btn" data-act="present" title="Present full screen (P)"><i class="fas fa-display"></i><span>Present</span></button>' +
            '</div>' +
            '<div class="pdfv-toolbar-right">' +
              '<div class="pdfv-hl-colors" id="pdfvColors">' + colorBtns + '</div>' +
              '<button type="button" class="pdfv-btn" data-act="clear-page" title="Clear highlights on current page"><i class="fas fa-eraser"></i></button>' +
              '<button type="button" class="pdfv-btn" data-act="clear-all" title="Clear all highlights"><i class="fas fa-trash-alt"></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="pdfv-body" id="pdfvBody">' +
            '<div class="pdfv-pages" id="pdfvPages"></div>' +
            '<div class="pdfv-loader" id="pdfvLoader">' +
              '<div class="pdfv-spinner"></div>' +
              '<p id="pdfvLoaderText">Connecting to server…</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pdfv-selection-menu" id="pdfvSelMenu">' +
          '<button type="button" class="pdfv-sel-btn" data-act="highlight"><i class="fas fa-highlighter"></i> Highlight</button>' +
          '<button type="button" class="pdfv-sel-btn" data-act="copy"><i class="fas fa-copy"></i> Copy</button>' +
        '</div>';

      document.body.appendChild(el);
      this.modal = el;
      this.bodyEl = el.querySelector('#pdfvBody');
      this.pagesEl = el.querySelector('#pdfvPages');
      this.selMenu = el.querySelector('#pdfvSelMenu');
      this.loaderEl = el.querySelector('#pdfvLoader');

      const self = this;
      el.querySelectorAll('.pdfv-btn, .pdfv-back-btn').forEach(btn => {
        btn.addEventListener('click', () => self._handleToolbar(btn.dataset.act));
      });
      el.querySelectorAll('.pdfv-color').forEach(btn => {
        btn.addEventListener('click', () => self._setColor(btn.dataset.color));
      });
      this._setColor('yellow');

      const pageInput = el.querySelector('#pdfvPageInput');
      pageInput.addEventListener('change', () => {
        const n = parseInt(pageInput.value, 10);
        if (n >= 1 && self.pdfDoc && n <= self.pdfDoc.numPages) self._scrollToPage(n);
      });

      this.selMenu.addEventListener('mousedown', e => e.preventDefault());
      this.selMenu.addEventListener('click', e => {
        const b = e.target.closest('.pdfv-sel-btn');
        if (!b) return;
        if (b.dataset.act === 'highlight') self._createHighlight();
        else if (b.dataset.act === 'copy') self._copySelection();
      });

      document.addEventListener('selectionchange', this._onSelectionChange);
      document.addEventListener('keydown', this._onKeyDown, true);
      this.bodyEl.addEventListener('scroll', this._onBodyScroll, { passive: true });
      window.addEventListener('blur', this._onWindowBlur);
      window.addEventListener('focus', this._onWindowFocus);
      document.addEventListener('visibilitychange', this._onVisibility);
      /* ⭐ Flush reading position on tab close / mobile app kill */
      window.addEventListener('pagehide', this._onPageHide);
      window.addEventListener('beforeunload', this._onPageHide);

      this.bodyEl.addEventListener('dragstart', e => e.preventDefault());
      this.bodyEl.addEventListener('contextmenu', e => { e.preventDefault(); return false; });
      this.bodyEl.addEventListener('copy', e => { e.preventDefault(); return false; });
      this.bodyEl.addEventListener('cut', e => { e.preventDefault(); return false; });

      this.pagesEl.addEventListener('click', e => {
        const mark = e.target.closest('mark.pdf-hl');
        if (!mark) return;
        e.stopPropagation();
        self._deleteHighlight(mark.dataset.hlId);
      });
      el.addEventListener('click', e => { if (e.target === el) self.close(); });
    }

    _handleToolbar(act) {
      if (act === 'close') return this.close();
      if (act === 'prev') return this._scrollToPage(Math.max(1, this.currentPage - 1));
      if (act === 'next') {
        const maxPage = this.previewLimit || (this.pdfDoc ? this.pdfDoc.numPages : 1);
        return this._scrollToPage(Math.min(maxPage, this.currentPage + 1));
      }
      if (act === 'zoomin') return this._changeZoom(0.15);
      if (act === 'zoomout') return this._changeZoom(-0.15);
      if (act === 'fit') return this._fitToWidth();
      if (act === 'fitpage') return this._fitToPage();
      if (act === 'present') return this._startPresentation(this.currentPage || 1);
      if (act === 'clear-page') return this._clearPageHighlights(this.currentPage);
      if (act === 'clear-all') return this._clearAllHighlights();
    }

    _setColor(c) {
      this.color = c;
      if (!this.modal) return;
      this.modal.querySelectorAll('.pdfv-color').forEach(b => {
        b.classList.toggle('active', b.dataset.color === c);
      });
    }
    async _renderAllPages() {
      /* Generation token: if a newer layout pass starts (zoom, fit,
         resize) while this one is still awaiting, this one stops and
         never appends its stale placeholders. */
      const gen = (this._layoutGen = (this._layoutGen || 0) + 1);
      this.pagesEl.innerHTML = '';
      this.pageEls.clear();
      this.textLayers.clear();
      this._disconnectPageObserver();

      const total = this.pdfDoc.numPages;
      this.totalPages = total;

      /* ── Compute render ceiling (unchanged) ── */
      let renderLimit;
      if (this.hasFullAccess) {
        renderLimit = total;
      } else if (this.previewPercent > 0) {
        renderLimit = Math.ceil(total * (this.previewPercent / 100));
        if (renderLimit < 1)     renderLimit = 1;
        if (renderLimit > total) renderLimit = total;
      } else {
        renderLimit = 0;
      }
      this.previewLimit = renderLimit;

      /* ── Toolbar updates (unchanged) ── */
      const pageCountEl = this.modal.querySelector('#pdfvPageCount');
      if (pageCountEl) pageCountEl.textContent = renderLimit || total;

      const titleEl = this.modal.querySelector('#pdfvTitle');
      if (titleEl) {
        const lockedCount = Math.max(0, total - renderLimit);
        titleEl.textContent = this.title;
        if (!this.hasFullAccess && renderLimit < total) {
          const chip = document.createElement('span');
          chip.className = 'pdfv-preview-chip';
          chip.title = `${lockedCount} page${lockedCount === 1 ? '' : 's'} locked`;
          chip.innerHTML = '<i class="fas fa-lock"></i> PREVIEW';
          titleEl.appendChild(chip);
        }
      }

      const pageInput = this.modal.querySelector('#pdfvPageInput');
      if (pageInput) pageInput.setAttribute('max', String(renderLimit || total));

      this._updateZoomLabel();
      this._updateHlCount();

      if (renderLimit === 0) {
        this.loaderEl.style.display = 'none';
        /* ⭐ No free pages at all — show a "login or purchase" card
           instead of an empty white screen. */
        this._renderBlankPaywallCard(total);
        return;
      }

      /* ============================================================
         PHASE 1 — render page 1 IMMEDIATELY.
         Everything else is deferred so the student can start
         reading as soon as the very first canvas is on screen.
         ============================================================ */

      /* Probe page 1 dimensions once — the same size is applied to
         every placeholder so scroll height never jumps. */
      let placeholderW = 612;
      let placeholderH = 792;
      try {
        const p1 = await this.pdfDoc.getPage(1);
        const vp1 = p1.getViewport({ scale: this.scale });
        placeholderW = Math.round(vp1.width);
        placeholderH = Math.round(vp1.height);
      } catch (e) {
        console.warn('[PDFViewer] placeholder probe failed:', e);
      }

      if (!this.active || gen !== this._layoutGen) return;

      /* Create page 1's placeholder */
      const page1El = document.createElement('div');
      page1El.className = 'pdfv-page';
      page1El.dataset.page = '1';
      page1El.style.width  = placeholderW + 'px';
      page1El.style.height = placeholderH + 'px';
      page1El.style.position = 'relative';
      page1El.style.background = '#ffffff';
      this.pagesEl.appendChild(page1El);
      this.pageEls.set(1, page1El);

      /* Render page 1 */
      await this._renderPage(1);
      if (!this.active || gen !== this._layoutGen) return;
      page1El.dataset.rendered = '1';

      /* ⚡ Prefetch page 2 while page 1 is still on screen.
         Most readers scroll within 1 s — having page 2 already
         rendered makes the transition feel instant. Runs in
         parallel with the rest of the skeleton build-out below. */
      if (renderLimit >= 2 && this.active) {
        const page2El = this.pageEls.get(2);
        if (page2El && page2El.dataset.rendered !== '1') {
          this._renderPage(2)
            .then(() => { page2El.dataset.rendered = '1'; })
            .catch(() => {});
        }
      }

      /* ============================================================
         PHASE 2 — HIDE THE LOADER NOW.
         Page 1 is on screen. The student can begin reading while
         the remaining skeletons and the observer are set up.
         ============================================================ */
      this.loaderEl.style.display = 'none';

      /* ============================================================
         PHASE 3 — build the remaining skeletons asynchronously.
         requestIdleCallback lets the browser finish its paint +
         layout pass first, so page 1 feels instant.
         ============================================================ */
      if (renderLimit <= 1) return;

      const buildRest = () => {
        if (!this.active || gen !== this._layoutGen) return;

        /* Build all placeholder divs in ONE batch via a document
           fragment. This is ~10× faster than appending each div
           individually and prevents layout thrash on huge PDFs.
           Skeletons are NOT added here — they're added lazily by
           the IntersectionObserver only for pages that come into
           view. This stops 500 shimmer animations from running at
           once on large documents. */
        const frag = document.createDocumentFragment();

        for (let i = 2; i <= renderLimit; i++) {
          const pageEl = document.createElement('div');
          pageEl.className = 'pdfv-page';
          pageEl.dataset.page = i;
          pageEl.style.width  = placeholderW + 'px';
          pageEl.style.height = placeholderH + 'px';
          pageEl.style.position = 'relative';
          pageEl.style.background = '#ffffff';

          frag.appendChild(pageEl);
          this.pageEls.set(i, pageEl);
        }

        this.pagesEl.appendChild(frag);

        if (!this.hasFullAccess && renderLimit < total) {
          this._renderPaywallCard(total, renderLimit);
        }

        this._setupPageObserver();

        /* ⭐ NEW: Restore the last reading position on this PDF.
           Runs AFTER every placeholder div exists so scrollIntoView
           can find the target page. The IntersectionObserver we
           just attached will lazy-render it on demand. */
        this._applyReadingResume();
      };

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(buildRest, { timeout: 400 });
      } else {
        setTimeout(buildRest, 0);
      }
    }
    _setupPageObserver() {
      this._disconnectPageObserver();

      if (typeof IntersectionObserver !== 'function') {
        this.pageEls.forEach((el, n) => {
          if (el.dataset.rendered !== '1') {
            this._renderPage(n).then(() => { el.dataset.rendered = '1'; });
          }
        });
        return;
      }

      this._pageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const pageEl = entry.target;
          if (!entry.isIntersecting) return;
          if (pageEl.dataset.rendered === '1') {
            this._pageObserver.unobserve(pageEl);
            return;
          }
          const pageNum = parseInt(pageEl.dataset.page, 10);
          if (!this._renderingPages) this._renderingPages = new Set();
          if (this._renderingPages.has(pageNum)) return;

          /* Inject the loading skeleton only for pages the user is
             about to see. Off-screen pages stay as plain white
             rectangles — no shimmer animation, no spinner, no CPU
             cost. This is critical for 200+ page PDFs. */
          if (!pageEl.querySelector('.pdfv-page-skeleton') && !pageEl.querySelector('.pdfv-canvas')) {
            const skel = document.createElement('div');
            skel.className = 'pdfv-page-skeleton';
            skel.innerHTML =
              '<div class="pdfv-skeleton-spinner"></div>' +
              '<div class="pdfv-skeleton-text">Loading page ' + pageNum + '…</div>';
            pageEl.appendChild(skel);
          }

          this._renderingPages.add(pageNum);
          this._pageObserver.unobserve(pageEl);

          this._renderPage(pageNum)
            .then(() => {
              pageEl.dataset.rendered = '1';
              this._renderingPages.delete(pageNum);
            })
            .catch((err) => {
              console.warn('[PDFViewer] lazy render failed page ' + pageNum, err);
              this._renderingPages.delete(pageNum);
            });
        });
      }, {
        root: this.bodyEl,
        rootMargin: '150% 0px 150% 0px',
        threshold: 0
      });

      this.pageEls.forEach((el) => {
        if (el.dataset.rendered !== '1') this._pageObserver.observe(el);
      });
    }

    _disconnectPageObserver() {
      if (this._pageObserver) {
        try { this._pageObserver.disconnect(); } catch (e) {}
        this._pageObserver = null;
      }
      /* ⭐ Also detach the paywall attention observer */
      if (this._paywallObserver) {
        try { this._paywallObserver.disconnect(); } catch (e) {}
        this._paywallObserver = null;
      }
      if (this._renderingPages) this._renderingPages.clear();
    }

    async _renderVisiblePagesNow() {
      const bodyRect = this.bodyEl.getBoundingClientRect();
      const tasks = [];
      this.pageEls.forEach((pageEl, n) => {
        if (pageEl.dataset.rendered === '1') return;
        const r = pageEl.getBoundingClientRect();
        if (r.bottom >= bodyRect.top - 200 && r.top <= bodyRect.bottom + 200) {
          tasks.push(
            this._renderPage(n)
              .then(() => { pageEl.dataset.rendered = '1'; })
              .catch(() => {})
          );
        }
      });
      await Promise.all(tasks);
    }

    /* ============================================================
       PAYWALL — appended after the last free-preview page.
       ============================================================ */
    /* ============================================================
       PAYWALL — appended after the last free-preview page.
       Renders an attractive lock card with a scroll-aware
       attention pulse and blurs the previous page when it enters
       the viewport.
       ============================================================ */
    _renderPaywallCard(totalPages, previewPages) {
      const locked = totalPages - previewPages;

      const card = document.createElement('div');
      card.className = 'pdfv-paywall';
      card.innerHTML = `
        <div class="pdfv-paywall-inner">
          <div class="pdfv-paywall-icon">
            <i class="fas fa-lock"></i>
          </div>
          <h3 class="pdfv-paywall-title">You've reached the end of the free preview</h3>
          <p class="pdfv-paywall-sub">
            You can read the first <strong>${previewPages}</strong> of
            <strong>${totalPages}</strong> pages for free.
            <span class="pdfv-paywall-locked">${locked} more page${locked === 1 ? '' : 's'} locked.</span>
          </p>
          <button type="button" class="btn btn-accent btn-lg pdfv-paywall-btn">
            <i class="fas fa-crown"></i> Unlock the full document
          </button>
          <p class="pdfv-paywall-note">
            <i class="fas fa-shield-halved"></i>
            Secure checkout · Instant access
          </p>
        </div>
      `;

      const btn = card.querySelector('.pdfv-paywall-btn');
      if (btn) {
        btn.addEventListener('click', () => this._onPaywallClick());
      }

      this.pagesEl.appendChild(card);

      /* ⭐ Scroll-triggered attention + blur of the last free page */
      this._attachPaywallAttention(card);
    }

    /* ============================================================
       BLANK PAYWALL — used when previewPercent = 0 (no free pages).
       Called instead of returning an empty white screen.
       ============================================================ */
        /* ============================================================
       BLANK PAYWALL — used when previewPercent = 0 AND the user
       has no full access. Shows a message tailored to the actual
       reason (login vs purchase) instead of a generic "locked".
       ============================================================ */
    _renderBlankPaywallCard(totalPages) {
      const reason = this.lockReason;

      let title    = 'This document is locked';
      let subtitle = `All <strong>${totalPages}</strong> page${totalPages === 1 ? '' : 's'} require purchase or an active subscription.`;
      let btnLabel = 'Unlock the full document';
      let btnIcon  = 'fa-crown';

      if (reason === 'login-required') {
        title    = 'Sign in to read this document';
        subtitle = `This is premium content. Log in or create a free account to access it.`;
        btnLabel = 'Log in to continue';
        btnIcon  = 'fa-right-to-bracket';
      } else if (reason === 'course-premium') {
        title    = 'This course is premium';
        subtitle = `All <strong>${totalPages}</strong> page${totalPages === 1 ? '' : 's'} of this document, and every other material in this course, are locked behind the course purchase.`;
        btnLabel = 'Unlock the whole course';
        btnIcon  = 'fa-crown';
      }

      const card = document.createElement('div');
      card.className = 'pdfv-paywall pdfv-paywall--blank';
      card.innerHTML = `
        <div class="pdfv-paywall-inner">
          <div class="pdfv-paywall-icon">
            <i class="fas fa-lock"></i>
          </div>
          <h3 class="pdfv-paywall-title">${title}</h3>
          <p class="pdfv-paywall-sub">${subtitle}</p>
          <button type="button" class="btn btn-accent btn-lg pdfv-paywall-btn">
            <i class="fas ${btnIcon}"></i> ${btnLabel}
          </button>
          <p class="pdfv-paywall-note">
            <i class="fas fa-shield-halved"></i>
            Secure checkout · Instant access
          </p>
        </div>
      `;
      const btn = card.querySelector('.pdfv-paywall-btn');
      if (btn) {
        btn.addEventListener('click', () => this._onPaywallClick());
      }
      this.pagesEl.appendChild(card);
    }

    /* ============================================================
       PAYWALL ATTENTION — when the user scrolls the paywall card
       into view, gently blur the previous page and pulse the CTA.
       This satisfies the "overlay appears when you try to scroll
       past the free limit" spec without a full-screen overlay.
       ============================================================ */
    _attachPaywallAttention(card) {
      if (typeof IntersectionObserver !== 'function') return;

      /* Detach any previous observer before attaching a new one */
      if (this._paywallObserver) {
        try { this._paywallObserver.disconnect(); } catch (e) {}
        this._paywallObserver = null;
      }

      const lastPageEl = this.pageEls.get(this.previewLimit);

      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            card.classList.add('pdfv-paywall--attention');
            if (lastPageEl) lastPageEl.classList.add('pdfv-page--fading');
          } else {
            card.classList.remove('pdfv-paywall--attention');
            if (lastPageEl) lastPageEl.classList.remove('pdfv-page--fading');
          }
        });
      }, {
        root: this.bodyEl,
        rootMargin: '0px 0px -20% 0px',
        threshold: 0.15
      });
      io.observe(card);
      this._paywallObserver = io;
    }
    /* ============================================================
       PAYWALL — CTA handler. Closes viewer, opens payment modal.
       ============================================================ */
       /* ============================================================
       PAYWALL — CTA handler. Routes by reason:
         • login-required → close + send user to the login screen
         • everything else → close + open the payment modal
       ============================================================ */
    _onPaywallClick() {
      const courseId   = this.courseId;
      const materialId = this.materialId;
      const reason     = this.lockReason;

      this.close();

      /* Login-required → route to the login screen. We do NOT
         attempt to open the payment modal here — there is no
         authenticated user to attach a payment to. */
      if (reason === 'login-required') {
        if (typeof showToast === 'function') {
          showToast('Please log in to access this content.', 'info');
        }
        try {
          if (location.hash !== '#/home') history.pushState(null, '', '#/home');
          if (typeof renderApp === 'function') renderApp();
        } catch (e) {
          /* never let a routing convenience throw */
        }
        return;
      }

      /* Purchase-required → open the payment modal. */
      if (typeof window.showPaymentModal === 'function' && courseId) {
        setTimeout(() => {
          window.showPaymentModal(courseId, materialId);
        }, 300);
        return;
      }

      if (typeof userToast === 'function') {
        userToast('Payment is unavailable right now.', 'error');
      }
    }
    async _renderPage(n) {
      const page = await this.pdfDoc.getPage(n);

      // ⚡ CRISP RENDER — render at devicePixelRatio so text is sharp
      // on Retina / high-DPI screens and mobile.
      // Cap at 3 to avoid blowing up memory on ultra-dense screens.
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));

      // CSS-space viewport (what the user sees — used for layout & text layer)
      const cssViewport = page.getViewport({ scale: this.scale });
      // Render-space viewport (higher res — what gets painted on the canvas)
      const renderViewport = page.getViewport({ scale: this.scale * dpr });

      const pageEl = this.pageEls.get(n);
      if (!pageEl) return;

      pageEl.innerHTML = '';
      pageEl.style.width  = cssViewport.width  + 'px';
      pageEl.style.height = cssViewport.height + 'px';
      pageEl.style.position = 'relative';

      const canvas = document.createElement('canvas');
      canvas.width  = renderViewport.width;
      canvas.height = renderViewport.height;
      // Keep CSS size equal to the CSS viewport — browser downsamples → sharp.
      canvas.style.width  = cssViewport.width  + 'px';
      canvas.style.height = cssViewport.height + 'px';
      canvas.className = 'pdfv-canvas';
      pageEl.appendChild(canvas);

      const ctx = canvas.getContext('2d', { alpha: false });
      // Improves text legibility on some browsers
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      await page.render({
        canvasContext: ctx,
        viewport: renderViewport
      }).promise;

      // Text layer uses the CSS viewport (correct CSS pixel coordinates)
      const textLayer = document.createElement('div');
      textLayer.className = 'pdfv-textlayer';
      textLayer.style.width  = cssViewport.width  + 'px';
      textLayer.style.height = cssViewport.height + 'px';
      textLayer.style.position = 'absolute';
      textLayer.style.top  = '0';
      textLayer.style.left = '0';
      textLayer.style.setProperty('--scale-factor', this.scale);
      pageEl.appendChild(textLayer);

      const textContent = await page.getTextContent();
      let task;
      try {
        task = pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          textContent: textContent,
          container: textLayer,
          viewport: cssViewport,   // ← was `viewport`, now CSS-space
          textDivs: []
        });
      } catch (e) {
        task = pdfjsLib.renderTextLayer({
          textContent: textContent,
          container: textLayer,
          viewport: cssViewport,   // ← same here
          textDivs: []
        });
      }
      await task.promise;
      this.textLayers.set(n, textLayer);

      /* Apply saved highlights for this page as soon as it renders */
      this._applyPageHighlights(n);
    }

    _scrollToPage(n) {
      const el = this.pageEls.get(n);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    _onBodyScroll() {
      this._hideSelMenu();
      if (!this.modal || !this.bodyEl) return;
      const scrollTop = this.bodyEl.scrollTop;

      /* ⚡ Early-exit: page offsetTop values are monotonically
         increasing (all placeholders have the same fixed height),
         so once we hit a page BELOW the viewport, we can stop.
         Turns O(n) scroll work into O(current-page) — a ~5× speedup
         on 500-page PDFs when the user is deep in the document. */
      let current = 1;
      for (const [page, el] of this.pageEls) {
        if (el.offsetTop - 60 <= scrollTop) current = page;
        else break;
      }
      this.currentPage = current;

      const inp = this.modal.querySelector('#pdfvPageInput');
      if (inp && document.activeElement !== inp) inp.value = current;

      /* Update reading-progress bar */
      const totalH = this.bodyEl.scrollHeight - this.bodyEl.clientHeight;
      const pct = totalH > 0
        ? Math.min(100, Math.max(0, (scrollTop / totalH) * 100))
        : 0;
      const bar = this.modal.querySelector('#pdfvProgress');
      if (bar) bar.style.width = pct + '%';

      /* ⭐ Persist the current page (debounced so long scrolls
         don't hammer localStorage). */
      this._scheduleProgressSave();
    }

    // Do NOT blur on tab switch — users often check notes/slides and come
    // back, and blurring the whole PDF for that is too aggressive.
    // Real screenshots are handled in `_onKeyDown` (PrintScreen, Cmd+Shift+3/4/5).
    _onVisibility() {
      // intentionally empty
    }

    _onWindowBlur() {
      // intentionally empty — no blur on focus loss
    }

    _onWindowFocus() {
      // nothing to restore
    }

    // Light, short blur ONLY for actual screenshot key presses.
    // 18px is enough to ruin a captured frame without hiding the content
    // from the student who is still reading it.
    _flashBlur() {
      if (!this.active || !this.modal) return;
      const shell = this.modal.querySelector('.pdfv-shell');
      if (!shell) return;

      clearTimeout(this._blurTimer);
      shell.style.transition = 'filter .08s ease';
      shell.style.filter = 'blur(18px)';

      this._blurTimer = setTimeout(() => {
        if (shell) shell.style.filter = '';
      }, 800);
    }

    _changeZoom(delta) { this._setZoom(this.scale + delta); }

    async _setZoom(scale) {
      scale = Math.max(0.4, Math.min(3.5, scale));
      if (Math.abs(scale - this.scale) < 0.01) return;

      const ratio = this.bodyEl.scrollTop / Math.max(1, this.bodyEl.scrollHeight);
      this.scale = scale;
      this._updateZoomLabel();

      this.bodyEl.style.visibility = 'hidden';
      await this._renderAllPages();
      this.bodyEl.scrollTop = ratio * this.bodyEl.scrollHeight;
      await this._renderVisiblePagesNow();
      this.bodyEl.style.visibility = '';
    }

    _updateZoomLabel() {
      if (!this.modal) return;
      const el = this.modal.querySelector('#pdfvZoomLabel');
      if (el) el.textContent = Math.round(this.scale * 100) + '%';
    }

    async _fitToWidth() {
      if (!this.pdfDoc) return;
      const page = await this.pdfDoc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const target = (this.bodyEl.clientWidth - 60) / vp.width;
      this._setZoom(target);
    }

    async _fitToPage() {
      if (!this.pdfDoc) return;
      try {
        const page = await this.pdfDoc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const availW = this.bodyEl.clientWidth  - 60;
        const availH = this.bodyEl.clientHeight - 60;
        const scale = Math.min(availW / vp.width, availH / vp.height);
        this._setZoom(scale);
      } catch (e) { /* silent */ }
    }

    _onSelectionChange() {
      if (!this.active) return;
      const self = this;
      clearTimeout(this._selTimer);
      this._selTimer = setTimeout(() => self._computeSelection(), 10);
    }

    _computeSelection() {
      if (!this.active || !this.modal) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return this._hideSelMenu();
      const range = sel.getRangeAt(0);
      const textLayer = this._findTextLayer(range.commonAncestorContainer);
      if (!textLayer) return this._hideSelMenu();
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return this._hideSelMenu();
      this.pendingSel = { textLayer };
      this.selMenu.style.display = 'flex';
      this.selMenu.style.visibility = 'hidden';
      this.selMenu.style.left = '0px';
      this.selMenu.style.top = '0px';
      const mr = this.selMenu.getBoundingClientRect();
      this.selMenu.style.visibility = '';
      let left = rect.left + rect.width / 2 - mr.width / 2;
      let top  = rect.top - mr.height - 10;
      if (top < 8) top = rect.bottom + 10;
      left = Math.max(8, Math.min(window.innerWidth - mr.width - 8, left));
      this.selMenu.style.left = left + 'px';
      this.selMenu.style.top  = top + 'px';
    }

    _findTextLayer(node) {
      while (node && node !== document) {
        if (node.classList && node.classList.contains('pdfv-textlayer')) return node;
        node = node.parentNode;
      }
      return null;
    }

    _hideSelMenu() {
      if (this.selMenu) this.selMenu.style.display = 'none';
      this.pendingSel = null;
    }

    _createHighlight() {
      if (!this.pendingSel) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed) return;
      const text = range.toString();
      if (!text.trim()) return;
      const textLayer = this.pendingSel.textLayer;
      const pageEl = textLayer.closest('.pdfv-page');
      if (!pageEl) return;
      const pageNum = parseInt(pageEl.dataset.page, 10);
      const start = this._textOffset(textLayer, range.startContainer, range.startOffset);
      const end   = this._textOffset(textLayer, range.endContainer, range.endOffset);
      if (start == null || end == null || start >= end) {
        return userToast('Could not create highlight — try selecting again.', 'error');
      }
      const pageHls = this.highlights.filter(h => h.page === pageNum);
      for (let i = 0; i < pageHls.length; i++) {
        if (start < pageHls[i].end && end > pageHls[i].start) {
          return userToast('Overlaps an existing highlight.', 'error');
        }
      }
      this.highlights.push({
        id: uid(), page: pageNum, start, end, text,
        color: this.color, createdAt: Date.now()
      });
      this._saveHighlights();
      this._applyPageHighlights(pageNum);
      this._updateHlCount();
      sel.removeAllRanges();
      this._hideSelMenu();
      userToast('Highlighted.', 'success');
    }

    /* ------------------------------------------------------------
       _textOffset — robust text-offset calculator
       ------------------------------------------------------------
       Previous implementation walked only TEXT_NODEs, so it returned
       null whenever the selection's start/end container was an
       element (which PDF.js produces constantly because every text
       run is wrapped in nested <span role="presentation"> tags).

       New implementation uses the browser's native Range API:
         • Works for text nodes ✅
         • Works for element nodes ✅
         • Works for selections that span multiple absolutely-
           positioned spans (very common in PDF.js) ✅
         • Works for selections that begin/end at a <br> ✅

       If a Range fails to build for any reason (corrupt selection,
       detached node, etc.) we return null and the caller falls back
       to the "try selecting again" toast — same behaviour as before,
       just far less likely to trigger.
       ------------------------------------------------------------ */
    _textOffset(root, node, offset) {
      try {
        const r = document.createRange();
        r.selectNodeContents(root);
        r.setEnd(node, offset);
        return r.toString().length;
      } catch (e) {
        console.warn('[PDFViewer] _textOffset failed:', e);
        return null;
      }
    }

    _copySelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString();
      if (!text) return;
      const self = this;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(
            () => userToast('Copied to clipboard.', 'success'),
            () => self._fallbackCopy(text)
          );
        } else this._fallbackCopy(text);
      } catch(e) { this._fallbackCopy(text); }
    }

    _fallbackCopy(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        userToast(ok ? 'Copied.' : 'Copy failed.', ok ? 'success' : 'error');
      } catch(e) { userToast('Copy failed.', 'error'); }
    }

    _deleteHighlight(id) {
      const idx = this.highlights.findIndex(h => h.id === id);
      if (idx === -1) return;
      const hl = this.highlights[idx];
      if (!confirm('Remove this highlight?')) return;
      this.highlights.splice(idx, 1);
      this._saveHighlights();
      this._applyPageHighlights(hl.page);
      this._updateHlCount();
    }

    _clearPageHighlights(pageNum) {
      const list = this.highlights.filter(h => h.page === pageNum);
      if (list.length === 0) return userToast('No highlights on this page.', 'info');
      if (!confirm('Remove ' + list.length + ' highlight(s) on this page?')) return;
      this.highlights = this.highlights.filter(h => h.page !== pageNum);
      this._saveHighlights();
      this._applyPageHighlights(pageNum);
      this._updateHlCount();
    }

    _clearAllHighlights() {
      if (this.highlights.length === 0) return userToast('No highlights to clear.', 'info');
      if (!confirm('Remove all ' + this.highlights.length + ' highlight(s)?')) return;
      this.highlights = [];
      this._saveHighlights();
      this._applyAllHighlights();
      this._updateHlCount();
    }

    _storageKey() { return 'aero_pdf_hl_' + this.materialId; }

    _loadHighlights() {
      try {
        const raw = localStorage.getItem(this._storageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        this.highlights = Array.isArray(parsed) ? parsed : [];
      } catch(e) { this.highlights = []; }
    }

    _saveHighlights() {
      try { localStorage.setItem(this._storageKey(), JSON.stringify(this.highlights)); } catch(e){}
    }

    /* ============================================================
       READING PROGRESS — resume where you left off
       ------------------------------------------------------------
       Stored per material in localStorage:
         • page       — last visible page
         • totalPages — sanity guard (clamps if a re-uploaded PDF
                        now has fewer pages than the saved one)
         • updatedAt  — timestamp of last save
       ============================================================ */

    _progressKey() {
      return 'aero_pdf_progress_' + this.materialId;
    }

    _loadReadingProgress() {
      this._resumePage = 1;
      try {
        const raw = localStorage.getItem(this._progressKey());
        if (!raw) return;
        const data = JSON.parse(raw);
        const page = parseInt(data && data.page, 10);
        if (Number.isFinite(page) && page > 1) this._resumePage = page;
      } catch (e) {
        this._resumePage = 1;
      }
    }

    _saveReadingProgress(immediate) {
      if (immediate && this._saveProgressTimer) {
        clearTimeout(this._saveProgressTimer);
        this._saveProgressTimer = null;
      }
      try {
        const payload = {
          page: this.currentPage || 1,
          totalPages: this.pdfDoc ? this.pdfDoc.numPages : (this.totalPages || 0),
          updatedAt: Date.now()
        };
        localStorage.setItem(this._progressKey(), JSON.stringify(payload));
      } catch (e) { /* quota / private mode — silent */ }
    }

    _scheduleProgressSave() {
      if (this._saveProgressTimer) return;
      this._saveProgressTimer = setTimeout(() => {
        this._saveProgressTimer = null;
        this._saveReadingProgress(false);
      }, 1200);
    }

    _applyReadingResume() {
      if (this._resumeApplied) return;
      this._resumeApplied = true;

      let target = this._resumePage;
      if (!target || target <= 1) return;

      /* Clamp to the free-preview ceiling if this material is locked
         and the saved position was deeper than the allowed range. */
      if (this.previewLimit && target > this.previewLimit) {
        target = this.previewLimit;
        this._resumePage = target;
      }

      const pageEl = this.pageEls.get(target);
      if (!pageEl) return;

      requestAnimationFrame(() => {
        if (!this.active || !this.bodyEl) return;

        /* Instant jump — not smooth — so the target is visible the
           moment the loader hides. */
        this.bodyEl.scrollTop = pageEl.offsetTop - 12;
        this.currentPage = target;

        const inp = this.modal && this.modal.querySelector('#pdfvPageInput');
        if (inp) inp.value = target;

        /* Render the target page immediately if the observer hasn't
           already kicked it off. */
        if (pageEl.dataset.rendered !== '1') {
          this._renderPage(target)
            .then(() => { pageEl.dataset.rendered = '1'; })
            .catch(() => {});
        }

        if (typeof userToast === 'function') {
          userToast('📖 Resuming from page ' + target, 'info');
        }
      });
    }

    /* Flush reading position when the tab is closed or the mobile
       app is backgrounded/killed. */
    _onPageHide() {
      if (!this.active) return;
      try { this._saveReadingProgress(true); } catch (e) {}
    }

    _updateHlCount() {
      if (!this.modal) return;
      const el = this.modal.querySelector('#pdfvHlCount');
      if (!el) return;
      const n = this.highlights.length;
      el.textContent = n > 0 ? '· ' + n + ' highlight' + (n === 1 ? '' : 's') : '';
    }

    _applyAllHighlights() {
      const self = this;
      this.textLayers.forEach((_, n) => self._applyPageHighlights(n));
    }

    _applyPageHighlights(pageNum) {
      const pageEl = this.pageEls.get(pageNum);
      const textLayer = this.textLayers.get(pageNum);
      if (!pageEl || !textLayer) return;
      pageEl.querySelectorAll('mark.pdf-hl').forEach(mark => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      });
      try { textLayer.normalize(); } catch(e){}
      const list = this.highlights.filter(h => h.page === pageNum);
      if (list.length === 0) return;
      list.sort((a,b) => b.start - a.start);
      for (let i = 0; i < list.length; i++) this._paintHighlight(list[i], textLayer);
    }

    _paintHighlight(hl, textLayer) {
      const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, null, false);
      const nodes = [];
      let cum = 0, n;
      while ((n = walker.nextNode())) {
        const len = n.nodeValue.length;
        nodes.push({ node: n, start: cum, end: cum + len });
        cum += len;
      }
      const total = cum;
      const start = Math.max(0, Math.min(hl.start, total));
      const end = Math.min(hl.end, total);
      if (start >= end) return;
      const targets = nodes.filter(t => t.end > start && t.start < end);
      const color = HL_COLORS[hl.color] || HL_COLORS.yellow;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const node = t.node;
        if (!node.parentNode) continue;
        const localStart = Math.max(0, start - t.start);
        const localEnd = Math.min(node.nodeValue.length, end - t.start);
        if (localStart >= localEnd) continue;
        const before = node.nodeValue.slice(0, localStart);
        const mid    = node.nodeValue.slice(localStart, localEnd);
        const after  = node.nodeValue.slice(localEnd);
        const mark = document.createElement('mark');
        mark.className = 'pdf-hl';
        mark.dataset.hlId = hl.id;
        mark.style.backgroundColor = color;
        mark.textContent = mid;
        const parent = node.parentNode;
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(mark);
        if (after) frag.appendChild(document.createTextNode(after));
        parent.replaceChild(frag, node);
      }
    }

    /* ============================================================
       ⭐ PRESENTATION MODE (2026-10-04)
       Full-screen, one slide at a time — for rendered PowerPoint
       decks (and any PDF). Keyboard: → ← Space PgUp/PgDn Home End,
       Esc to exit. Click right/left half or swipe on touch.
       The screenshot shield stays active on top.
       ============================================================ */
    async _startPresentation(startPage) {
      if (!this.pdfDoc || this._present) return;
      const max = this.previewLimit || this.pdfDoc.numPages;
      const ov = document.createElement('div');
      ov.className = 'pdfv-present';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-label', 'Slideshow');
      ov.innerHTML =
        '<div class="pdfv-present-stage"><canvas></canvas></div>' +
        '<div class="pdfv-present-bar">' +
          '<button type="button" data-p="prev" aria-label="Previous slide"><i class="fas fa-chevron-left"></i></button>' +
          '<span class="pdfv-present-count"></span>' +
          '<button type="button" data-p="next" aria-label="Next slide"><i class="fas fa-chevron-right"></i></button>' +
          '<span class="pdfv-present-sep"></span>' +
          '<button type="button" data-p="exit" aria-label="Exit slideshow"><i class="fas fa-compress"></i> Exit</button>' +
        '</div>' +
        '<div class="pdfv-present-progress"><span></span></div>';
      ov.addEventListener('contextmenu', e => e.preventDefault());
      ov.addEventListener('dragstart', e => e.preventDefault());
      document.body.appendChild(ov);


      const st = this._present = {
        ov, page: Math.max(1, Math.min(max, startPage || 1)), max,
        canvas: ov.querySelector('canvas'), task: null, hideTimer: null, touchX: null
      };

      const go = (n) => { n = Math.max(1, Math.min(st.max, n)); if (n !== st.page) { st.page = n; this._presentRender(); } };
      st.go = go;
      st.onKey = (e) => {
        if (!this._present) return;
        const k = e.key;
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { e.preventDefault(); e.stopPropagation(); go(st.page + 1); }
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { e.preventDefault(); e.stopPropagation(); go(st.page - 1); }
        else if (k === 'Home') { e.preventDefault(); go(1); }
        else if (k === 'End') { e.preventDefault(); go(st.max); }
        else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); this._endPresentation(); }
      };
      document.addEventListener('keydown', st.onKey, true);

      ov.addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]');
        if (b) {
          if (b.dataset.p === 'prev') go(st.page - 1);
          else if (b.dataset.p === 'next') go(st.page + 1);
          else this._endPresentation();
          return;
        }
        if (e.target.closest('.pdfv-present-bar')) return;
        const r = ov.getBoundingClientRect();
        go(st.page + (e.clientX > r.left + r.width / 3 ? 1 : -1));
      });
      ov.addEventListener('touchstart', e => { st.touchX = e.touches[0].clientX; }, { passive: true });
      ov.addEventListener('touchend', e => {
        if (st.touchX == null) return;
        const dx = e.changedTouches[0].clientX - st.touchX;
        st.touchX = null;
        if (Math.abs(dx) > 40) go(st.page + (dx < 0 ? 1 : -1));
      });
      /* Auto-hide the control bar while presenting */
      st.onMove = () => {
        ov.classList.add('show-ui');
        clearTimeout(st.hideTimer);
        st.hideTimer = setTimeout(() => ov.classList.remove('show-ui'), 2200);
      };
      ov.addEventListener('mousemove', st.onMove);
      st.onMove();

      st.onResize = () => this._presentRender();
      window.addEventListener('resize', st.onResize);
      st.onFs = () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement && this._present && st.wasFs) {
          this._endPresentation();
        }
      };
      document.addEventListener('fullscreenchange', st.onFs);
      document.addEventListener('webkitfullscreenchange', st.onFs);

      try {
        const req = ov.requestFullscreen || ov.webkitRequestFullscreen;
        if (req) { await req.call(ov); st.wasFs = true; }
      } catch (e) { /* fullscreen refused — overlay still covers the window */ }
      requestAnimationFrame(() => ov.classList.add('active'));
      await this._presentRender();
    }

    async _presentRender() {
      const st = this._present;
      if (!st || !this.pdfDoc) return;
      const n = st.page;
      st.ov.querySelector('.pdfv-present-count').textContent = n + ' / ' + st.max;
      st.ov.querySelector('.pdfv-present-progress span').style.width = (n / st.max * 100) + '%';
      st.ov.querySelector('[data-p="prev"]').disabled = n <= 1;
      st.ov.querySelector('[data-p="next"]').disabled = n >= st.max;
      try {
        if (st.task) { try { st.task.cancel(); } catch (e) {} }
        const page = await this.pdfDoc.getPage(n);
        if (!this._present || st.page !== n) return;
        const base = page.getViewport({ scale: 1 });
        const W = window.innerWidth, H = window.innerHeight;
        const fit = Math.min(W / base.width, H / base.height);
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const vp = page.getViewport({ scale: fit * dpr });
        const c = st.canvas;
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        c.style.width = Math.floor(vp.width / dpr) + 'px';
        c.style.height = Math.floor(vp.height / dpr) + 'px';
        st.task = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp });
        await st.task.promise;
        /* warm the next slide */
        if (n < st.max) this.pdfDoc.getPage(n + 1).catch(() => {});
      } catch (e) {
        if (e && e.name === 'RenderingCancelledException') return;
        console.warn('[present]', e && e.message);
      }
    }

    _endPresentation(silent) {
      const st = this._present;
      if (!st) return;
      this._present = null;
      document.removeEventListener('keydown', st.onKey, true);
      window.removeEventListener('resize', st.onResize);
      document.removeEventListener('fullscreenchange', st.onFs);
      document.removeEventListener('webkitfullscreenchange', st.onFs);
      clearTimeout(st.hideTimer);
      try { if (st.task) st.task.cancel(); } catch (e) {}
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
      }
      st.ov.classList.remove('active');
      setTimeout(() => { try { st.ov.remove(); } catch (e) {} }, 200);
      if (!silent && this.active) { try { this._scrollToPage(st.page); } catch (e) {} }
    }

    /* 2026-10-04: visible watermarks removed (owner's decision). */
    _renderWatermark() { /* intentionally no-op */ }
    _onKeyDown(e) {
      if (!this.active) return;
      if (this._present) return;          // slideshow owns the keyboard
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }

      const inField = e.target && e.target.matches &&
                      e.target.matches('input, textarea, [contenteditable="true"]');
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        this._startPresentation(this.currentPage || 1);
        return;
      }

      /* Navigation shortcuts (plain keys, not typing) */
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const maxPage = this.previewLimit || (this.pdfDoc ? this.pdfDoc.numPages : 1);
        const cur = this.currentPage || 1;
        const go = (n) => { e.preventDefault(); this._scrollToPage(n); };

        switch (e.key) {
          case 'PageDown':   return go(Math.min(maxPage, cur + 1));
          case 'PageUp':     return go(Math.max(1, cur - 1));
          case 'ArrowRight': return go(Math.min(maxPage, cur + 1));
          case 'ArrowLeft':  return go(Math.max(1, cur - 1));
          case 'Home':       return go(1);
          case 'End':        return go(maxPage);
          case 'w': case 'W': return (e.preventDefault(), this._fitToWidth());
          case 'f': case 'F': return (e.preventDefault(), this._fitToPage());
        }
      }

      /* Screenshot blocking (unchanged) */
      if (e.key === 'PrintScreen' || e.keyCode === 44) {
        e.preventDefault();
        this._flashBlur();   // shield shows the warning — no second toast
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && ['3','4','5','s','S'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        this._flashBlur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p' || e.key === 'S' || e.key === 'P')) {
        e.preventDefault(); e.stopPropagation();
        /* Ctrl/Cmd+P is already answered by the shield's cover */
        if (e.key === 's' || e.key === 'S') userToast('Downloading is disabled.', 'error');
        return;
      }
      if (e.key === 'F12' ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I','J','C','i','j','c'].includes(e.key))) {
        e.preventDefault(); e.stopPropagation(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault(); e.stopPropagation(); return;
      }
    }

    close() {
      if (!this.active) return;
      if (this._present) { try { this._endPresentation(true); } catch (e) {} }

      /* ⭐ Persist the last read page synchronously before the DOM
         is torn down. This is what makes "Back" and Esc restore
         correctly on the next open. */
      try { this._saveReadingProgress(true); } catch (e) {}

      this.active = false;
      clearTimeout(this._selTimer);
      clearTimeout(this._blurTimer);
      clearTimeout(this._saveProgressTimer);
      document.removeEventListener('selectionchange', this._onSelectionChange);
      document.removeEventListener('keydown', this._onKeyDown, true);
      if (this.bodyEl) this.bodyEl.removeEventListener('scroll', this._onBodyScroll);
      window.removeEventListener('blur', this._onWindowBlur);
      window.removeEventListener('focus', this._onWindowFocus);
      document.removeEventListener('visibilitychange', this._onVisibility);
      window.removeEventListener('pagehide', this._onPageHide);
      window.removeEventListener('beforeunload', this._onPageHide);
      document.body.style.overflow = this._prevBodyOverflow || '';

      const m = this.modal;
      if (m) {
        m.classList.remove('active');
        setTimeout(() => { try { m.remove(); } catch(e){} }, 240);
      }
      this._disconnectPageObserver();
      this.pdfDoc = null;
      this.pageEls.clear();
      this.textLayers.clear();
      this.pendingSel = null;
      const saved = this.materialId;
      this._init();
      this.materialId = saved;
    }
  }

  window.PDFViewer = new PDFViewer();
  console.log('[AeroMediaViewer v5] Ready — hardened protection + fixed YouTube embed');
})();