'use strict';

// v9 scanner reliability layer.
// Goal: make animated pairing QR codes easier for real phone cameras to read.
// - Pairing frames contain less data, so each QR is physically simpler.
// - Pairing frames stay on-screen longer.
// - Android gets a second canvas/jsQR decoder running beside ZXing/native scan.
// - Sender/answer QR loops get pause + previous/next controls for hard cases.

const V9_PAIR_CHUNK_SIZE = 118;
const V9_PAIR_FRAME_MS = 1700;
const V9_PAIR_MIN_MS = 1200;
const V9_PAIR_MAX_MS = 2800;

const v9PreviousMakeFrames = makeFrames;
makeFrames = async function makeV9Frames(kind, text, chunkSize) {
  if (kind !== 'offer' && kind !== 'answer') {
    return v9PreviousMakeFrames(kind, text, chunkSize);
  }

  const payload = stringToBase64Url(text);
  const id = randomId();
  const checksum = await sha256Short(payload);
  const total = Math.max(1, Math.ceil(payload.length / V9_PAIR_CHUNK_SIZE));
  const frames = [];

  for (let index = 0; index < total; index += 1) {
    const chunk = payload.slice(index * V9_PAIR_CHUNK_SIZE, (index + 1) * V9_PAIR_CHUNK_SIZE);
    frames.push(`${FRAME_PREFIX}|${id}|${kind}|${index}|${total}|${checksum}|${chunk}`);
  }
  return frames;
};

const v9PreviousAnimatorStart = QrAnimator.prototype.start;
QrAnimator.prototype.start = function startV9ReadableFrames(frames) {
  const first = String(frames?.[0] || '');
  const pairing = first.includes('|offer|') || first.includes('|answer|');
  if (!pairing) return v9PreviousAnimatorStart.call(this, frames);

  this.stop();
  this.frames = Array.isArray(frames) ? frames : [];
  this.index = 0;
  if (!this.frames.length) return;

  if (this.speedControl) {
    this.speedControl.min = String(V9_PAIR_MIN_MS);
    this.speedControl.max = String(V9_PAIR_MAX_MS);
    this.speedControl.step = '100';
    if (Number(this.speedControl.value) < V9_PAIR_MIN_MS) {
      this.speedControl.value = String(V9_PAIR_FRAME_MS);
    }
  }

  this.render();
  if (this.frames.length > 1) {
    const delay = Math.max(V9_PAIR_MIN_MS, Number(this.speedControl?.value || V9_PAIR_FRAME_MS));
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      this.render();
    }, delay);
  }
};

function addV9ManualControls(containerId, animator) {
  const container = document.getElementById(containerId);
  if (!container || container.parentElement?.querySelector(`[data-v9-controls="${containerId}"]`)) return;

  const row = document.createElement('div');
  row.dataset.v9Controls = containerId;
  row.className = 'button-row v9-frame-controls';
  row.innerHTML = `
    <button type="button" class="secondary" data-v9-action="prev">◀ Previous</button>
    <button type="button" class="secondary" data-v9-action="pause">Pause QR</button>
    <button type="button" class="secondary" data-v9-action="next">Next ▶</button>
  `;
  container.insertAdjacentElement('afterend', row);

  const pause = row.querySelector('[data-v9-action="pause"]');
  row.querySelector('[data-v9-action="prev"]')?.addEventListener('click', () => {
    if (!animator.frames.length) return;
    animator.stop();
    animator.index = (animator.index - 1 + animator.frames.length) % animator.frames.length;
    animator.render();
    if (pause) pause.textContent = 'Resume QR';
  });
  row.querySelector('[data-v9-action="next"]')?.addEventListener('click', () => {
    if (!animator.frames.length) return;
    animator.stop();
    animator.index = (animator.index + 1) % animator.frames.length;
    animator.render();
    if (pause) pause.textContent = 'Resume QR';
  });
  pause?.addEventListener('click', () => {
    if (!animator.frames.length) return;
    if (animator.timer) {
      animator.stop();
      pause.textContent = 'Resume QR';
    } else {
      const currentIndex = animator.index;
      const frames = animator.frames;
      animator.start(frames);
      animator.index = Math.min(currentIndex, frames.length - 1);
      animator.render();
      pause.textContent = 'Pause QR';
    }
  });
}

function loadV9JsQr() {
  if (typeof window.jsQR === 'function') return Promise.resolve();
  if (window.__qrAnythingV9JsQrPromise) return window.__qrAnythingV9JsQrPromise;

  const sources = [
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
  ];

  window.__qrAnythingV9JsQrPromise = new Promise((resolve, reject) => {
    let index = 0;
    const next = () => {
      if (index >= sources.length) {
        reject(new Error('Extra QR decoder could not be loaded.'));
        return;
      }
      const script = document.createElement('script');
      script.src = sources[index++];
      script.crossOrigin = 'anonymous';
      script.onload = () => typeof window.jsQR === 'function' ? resolve() : next();
      script.onerror = next;
      document.head.appendChild(script);
    };
    next();
  });

  return window.__qrAnythingV9JsQrPromise;
}

function stopV9CanvasAssist() {
  if (state.scan.v9CanvasTimer) clearTimeout(state.scan.v9CanvasTimer);
  if (state.scan.v9HintTimer) clearTimeout(state.scan.v9HintTimer);
  state.scan.v9CanvasTimer = null;
  state.scan.v9HintTimer = null;
  state.scan.v9CanvasBusy = false;
  state.scan.v9AssistCanvas = null;
}

async function startV9CanvasAssist() {
  const isIos = typeof IOS_DEVICE !== 'undefined' && IOS_DEVICE;
  if (isIos || !state.scan.active) return;

  try {
    await loadV9JsQr();
  } catch (error) {
    console.debug('v9 jsQR assist unavailable', error);
    return;
  }

  if (!state.scan.active) return;

  const video = $('cameraVideo');
  if (!video) return;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;

  state.scan.v9AssistCanvas = canvas;
  state.scan.v9LastAssistRaw = '';
  state.scan.v9LastDetectedAt = 0;
  let useCenterCrop = true;

  const decode = async () => {
    if (!state.scan.active) return;

    if (!state.scan.v9CanvasBusy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      state.scan.v9CanvasBusy = true;
      try {
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        let sx = 0;
        let sy = 0;
        let sw = sourceWidth;
        let sh = sourceHeight;

        if (useCenterCrop) {
          const side = Math.floor(Math.min(sourceWidth, sourceHeight) * 0.88);
          sx = Math.floor((sourceWidth - side) / 2);
          sy = Math.floor((sourceHeight - side) / 2);
          sw = side;
          sh = side;
        }
        useCenterCrop = !useCenterCrop;

        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const width = Math.max(1, Math.round(sw * scale));
        const height = Math.max(1, Math.round(sh * scale));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        const result = window.jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });

        if (result?.data) {
          const raw = String(result.data).trim();
          state.scan.v9LastDetectedAt = Date.now();
          if (raw && raw !== state.scan.v9LastAssistRaw) {
            state.scan.v9LastAssistRaw = raw;
            try { navigator.vibrate?.(18); } catch {}
          }
          await consumeScannedQr(raw);
        }
      } catch (error) {
        if (state.scan.active) console.debug('v9 canvas QR retry', error);
      } finally {
        state.scan.v9CanvasBusy = false;
      }
    }

    if (state.scan.active) state.scan.v9CanvasTimer = setTimeout(decode, 120);
  };

  decode();

  state.scan.v9HintTimer = setTimeout(() => {
    if (!state.scan.active || Number($('scanProgress')?.value || 0) > 0) return;
    $('scanProgressText').textContent = 'Camera is working, but it has not read a QR frame yet.';
    $('scanHint').textContent = 'Move closer until the QR nearly fills the green box, turn the other screen brightness up, and let one frame sit still for a moment.';
  }, 5000);
}

const v9PreviousStartScanner = startScanner;
startScanner = async function startV9Scanner(options) {
  stopV9CanvasAssist();
  const result = await v9PreviousStartScanner(options);
  if (state.scan.active) startV9CanvasAssist();
  return result;
};

const v9PreviousStopScanner = stopScanner;
stopScanner = async function stopV9Scanner() {
  stopV9CanvasAssist();
  return v9PreviousStopScanner();
};

(function initV9Ui() {
  const style = document.createElement('style');
  style.id = 'v9ScannerReliabilityStyles';
  style.textContent = `
    .v9-frame-controls { margin-top:.65rem; grid-template-columns:repeat(3,minmax(0,1fr)); }
    .v9-frame-controls button { min-height:44px; }
    #senderQr .v5-qr-holder, #answerQr .v5-qr-holder { padding:26px !important; }
    #senderQr canvas, #answerQr canvas { image-rendering:pixelated; }
    @media (max-width:560px) {
      .v9-frame-controls { grid-template-columns:1fr 1fr 1fr; gap:.4rem; }
      .v9-frame-controls button { padding:.65rem .35rem; font-size:.82rem; }
    }
  `;
  document.head.appendChild(style);

  for (const id of ['senderSpeed', 'answerSpeed']) {
    const control = $(id);
    if (control) {
      control.min = String(V9_PAIR_MIN_MS);
      control.max = String(V9_PAIR_MAX_MS);
      control.step = '100';
      control.value = String(V9_PAIR_FRAME_MS);
    }
  }

  addV9ManualControls('senderQr', senderAnimator);
  addV9ManualControls('answerQr', answerAnimator);

  const senderLabel = document.querySelector('label[for="senderSpeed"]');
  const answerLabel = document.querySelector('label[for="answerSpeed"]');
  if (senderLabel) senderLabel.textContent = 'Animation speed — slower is easier to scan';
  if (answerLabel) answerLabel.textContent = 'Animation speed — slower is easier to scan';
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => registration.update()).catch(() => {});
}
