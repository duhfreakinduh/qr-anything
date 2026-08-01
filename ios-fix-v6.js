'use strict';

// iPhone/iPad camera compatibility layer.
// iOS Safari is more reliable when camera capture begins directly from the tap,
// only one getUserMedia stream is used, video plays inline, and QR decoding is
// performed from a canvas instead of starting a second camera reader.

const IOS_DEVICE = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const v5StartScannerForNonIos = startScanner;
const v5StopScannerForNonIos = stopScanner;

function loadJsQrForIos() {
  if (typeof window.jsQR === 'function') return Promise.resolve();
  if (window.__qrAnythingJsQrPromise) return window.__qrAnythingJsQrPromise;

  const sources = [
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
  ];

  window.__qrAnythingJsQrPromise = new Promise((resolve, reject) => {
    let index = 0;
    const tryNext = () => {
      if (index >= sources.length) {
        reject(new Error('The iPhone QR decoder could not be downloaded. Check the internet connection and reload.'));
        return;
      }
      const script = document.createElement('script');
      script.src = sources[index++];
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        if (typeof window.jsQR === 'function') resolve();
        else tryNext();
      };
      script.onerror = tryNext;
      document.head.appendChild(script);
    };
    tryNext();
  });

  return window.__qrAnythingJsQrPromise;
}

function stopIosScannerResources(hideModal = true) {
  state.scan.active = false;

  if (state.scan.iosScanTimer) clearTimeout(state.scan.iosScanTimer);
  state.scan.iosScanTimer = null;

  if (state.scan.animationFrame) cancelAnimationFrame(state.scan.animationFrame);
  if (state.scan.assistAnimationFrame) cancelAnimationFrame(state.scan.assistAnimationFrame);
  state.scan.animationFrame = null;
  state.scan.assistAnimationFrame = null;

  try { state.scan.controls?.stop(); } catch {}
  state.scan.controls = null;
  state.scan.zxingReader = null;
  state.scan.assistDetector = null;

  state.scan.stream?.getTracks?.().forEach(track => track.stop());
  state.scan.stream = null;

  const video = $('cameraVideo');
  if (video) {
    video.srcObject?.getTracks?.().forEach(track => track.stop());
    try { video.pause(); } catch {}
    video.srcObject = null;
  }

  if (hideModal) setHidden($('scannerModal'), true);
}

async function requestIosCameraStream() {
  const attempts = [
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    },
    { audio: false, video: { facingMode: 'environment' } },
    { audio: false, video: true }
  ];

  let lastError;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') throw error;
    }
  }
  throw lastError || new Error('The camera could not be opened.');
}

function waitForIosVideo(video, timeoutMs = 10000) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The iPhone camera opened but did not begin showing video.'));
    }, timeoutMs);
    const ready = () => {
      if (video.videoWidth <= 0) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('playing', ready);
      video.removeEventListener('resize', ready);
    };
    video.addEventListener('loadedmetadata', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('resize', ready);
  });
}

function beginIosCanvasScanner(video) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The iPhone QR scanner could not create its image reader.');

  state.scan.iosCanvas = canvas;
  let busy = false;

  const scan = async () => {
    if (!state.scan.active) return;

    if (!busy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      busy = true;
      try {
        const maxWidth = 960;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        context.drawImage(video, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        const result = window.jsQR(pixels.data, width, height, {
          inversionAttempts: 'attemptBoth'
        });

        if (result?.data) await consumeScannedQr(result.data);
      } catch (error) {
        if (state.scan.active) console.debug('iPhone QR scan retry', error);
      } finally {
        busy = false;
      }
    }

    if (state.scan.active) state.scan.iosScanTimer = setTimeout(scan, 90);
  };

  scan();
}

startScanner = function startIosCompatibleScanner(options) {
  if (!IOS_DEVICE) return v5StartScannerForNonIos(options);

  // Do this synchronously so getUserMedia remains tied to the user's tap.
  stopIosScannerResources(false);

  state.scan.active = true;
  state.scan.targetKind = options.expectedKind;
  state.scan.onComplete = options.onComplete;
  state.scan.sessions = new Map();
  state.scan.lastRaw = '';
  state.scan.lastSeenAt = 0;
  state.scan.processing = false;

  $('scannerTitle').textContent = options.title;
  $('scanProgress').value = 0;
  $('scanProgressText').textContent = 'Starting iPhone camera…';
  $('scanHint').textContent = 'Tap Allow when Safari asks for camera access.';
  $('pastePairingText').value = '';
  setHidden($('scannerModal'), false);

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('scanProgressText').textContent = 'Safari cannot use the camera from this page.';
    $('scanHint').textContent = 'Open the live HTTPS address directly in Safari—not inside Messages, Facebook, Gmail, GitHub, or another app.';
    return Promise.resolve();
  }

  const video = $('cameraVideo');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  // Request the camera immediately, before awaiting decoder downloads.
  const cameraPromise = requestIosCameraStream();
  const decoderPromise = loadJsQrForIos();

  return Promise.all([cameraPromise, decoderPromise])
    .then(async ([stream]) => {
      if (!state.scan.active) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      state.scan.stream = stream;
      video.srcObject = stream;
      await waitForIosVideo(video);

      try {
        await video.play();
      } catch (error) {
        // Camera streams may already be playing after permission is accepted.
        if (video.paused) throw error;
      }

      const track = stream.getVideoTracks()[0];
      try {
        const capabilities = track?.getCapabilities?.();
        if (capabilities?.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
      } catch (error) {
        console.debug('Continuous focus is unavailable on this iPhone', error);
      }

      $('scanProgressText').textContent = 'iPhone camera ready—looking for QR frames…';
      $('scanHint').textContent = 'Use Safari, turn the other screen bright, and keep the whole QR inside the green box.';
      beginIosCanvasScanner(video);
    })
    .catch(error => {
      console.error(error);
      stopIosScannerResources(false);
      setHidden($('scannerModal'), false);

      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      const noCamera = error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError';
      const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

      $('scanProgressText').textContent = denied
        ? 'Camera permission is blocked.'
        : noCamera
          ? 'No camera was available.'
          : 'The iPhone camera could not start.';

      if (denied) {
        $('scanHint').textContent = 'On iPhone: Settings → Safari → Camera → Allow, then reload this page.';
      } else if (standalone) {
        $('scanHint').textContent = 'Open the website in a normal Safari tab instead of the Home Screen app, then try again.';
      } else {
        $('scanHint').textContent = `${error.message || 'Close Safari, reopen the live website, and try again.'}`;
      }
    });
};

stopScanner = function stopIosCompatibleScanner() {
  if (!IOS_DEVICE) return v5StopScannerForNonIos();
  stopIosScannerResources(true);
  return Promise.resolve();
};

if (IOS_DEVICE && $('secureBadge')) {
  $('secureBadge').textContent = 'iPhone + Android • Cellular or Wi-Fi';
}
