'use strict';

// Compatibility and connectivity fixes loaded after the main app.
// 1) ZXing camera scanner works in browsers that do not support BarcodeDetector.
// 2) TURN relay lets WebRTC connect across cellular and different networks.

const INTERNET_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:openrelay.metered.ca:80' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

createPeer = function createInternetPeer(role) {
  closePeer();
  state.role = role;

  const pc = new RTCPeerConnection({
    iceServers: INTERNET_ICE_SERVERS,
    iceCandidatePoolSize: 8,
    iceTransportPolicy: 'all'
  });

  state.pc = pc;

  pc.onconnectionstatechange = () => {
    const status = pc.connectionState;
    const friendly = {
      new: 'Starting',
      connecting: 'Connecting over the internet…',
      connected: 'Connected',
      disconnected: 'Connection interrupted',
      failed: 'Connection failed',
      closed: 'Connection closed'
    }[status] || status;

    if (role === 'sender') {
      $('senderStatus').textContent = status === 'connected'
        ? 'Connected. Starting encrypted transfer…'
        : friendly;
    } else {
      $('receiverStatus').textContent = status === 'connected'
        ? 'Connected. Waiting for the encrypted transfer…'
        : friendly;
    }

    if (status === 'failed') {
      toast('Internet connection failed. Recreate both pairing codes and try again.', 6000);
    }
  };

  pc.onicecandidateerror = event => {
    // A failed STUN/TURN candidate is not necessarily fatal because ICE tries the others.
    console.warn('ICE candidate error', event.errorCode, event.errorText);
  };

  return pc;
};

async function consumeScannedQr(raw) {
  if (!state.scan.active || !raw || state.scan.processing) return;

  const now = Date.now();
  if (raw === state.scan.lastRaw && now - state.scan.lastSeenAt < 140) return;
  state.scan.lastRaw = raw;
  state.scan.lastSeenAt = now;
  state.scan.processing = true;

  try {
    const result = await ingestFrame(raw, state.scan.targetKind);
    if (!result.accepted) return;

    $('scanProgress').value = result.percent;
    $('scanProgressText').textContent = `${result.received} of ${result.total} frames collected`;
    $('scanHint').textContent = result.complete
      ? 'QR data complete.'
      : 'Hold steady while the QR frames change.';

    if (state.scan.targetKind === 'direct') {
      setHidden($('directScanProgress'), false);
      $('directProgress').value = result.percent;
      $('directProgressText').textContent = `${result.received} of ${result.total} frames`;
    }

    if (result.complete) {
      const callback = state.scan.onComplete;
      await stopScanner();
      await callback(result.text);
    }
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not read the QR code.', 5000);
  } finally {
    state.scan.processing = false;
  }
}

async function startNativeScanner() {
  state.scan.detector = new BarcodeDetector({ formats: ['qr_code'] });
  state.scan.stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  const video = $('cameraVideo');
  video.srcObject = state.scan.stream;
  await video.play();

  const loop = async () => {
    if (!state.scan.active) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await state.scan.detector.detect(video);
        for (const code of codes) await consumeScannedQr(code.rawValue);
      }
    } catch (error) {
      if (state.scan.active) console.debug('Native QR retry', error);
    }
    if (state.scan.active) state.scan.animationFrame = requestAnimationFrame(loop);
  };

  loop();
}

function loadZxingLibrary() {
  if (window.ZXingBrowser?.BrowserQRCodeReader) return Promise.resolve();
  if (window.__zxingLoading) return window.__zxingLoading;
  window.__zxingLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@zxing/browser@0.2.0/umd/zxing-browser.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => window.ZXingBrowser?.BrowserQRCodeReader
      ? resolve()
      : reject(new Error('The QR scanner library loaded incorrectly.'));
    script.onerror = () => reject(new Error('The compatible QR scanner library could not be downloaded.'));
    document.head.appendChild(script);
  });
  return window.__zxingLoading;
}

async function startZxingScanner() {
  await loadZxingLibrary();

  const video = $('cameraVideo');
  const reader = new ZXingBrowser.BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: 40,
    delayBetweenScanSuccess: 40
  });
  state.scan.zxingReader = reader;

  state.scan.controls = await reader.decodeFromConstraints(
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    video,
    (result, error) => {
      if (result) {
        const raw = typeof result.getText === 'function' ? result.getText() : result.text;
        consumeScannedQr(raw);
      }
      // ZXing reports a NotFoundException on normal frames without a QR; ignore it.
      if (error && error.name !== 'NotFoundException') console.debug('ZXing scan retry', error);
    }
  );
}

startScanner = async function startCompatibleScanner({ title, expectedKind, onComplete }) {
  await stopScanner();

  state.scan.active = true;
  state.scan.targetKind = expectedKind;
  state.scan.onComplete = onComplete;
  state.scan.sessions = new Map();
  state.scan.lastRaw = '';
  state.scan.lastSeenAt = 0;
  state.scan.processing = false;

  $('scannerTitle').textContent = title;
  $('scanProgress').value = 0;
  $('scanProgressText').textContent = 'Starting camera…';
  $('scanHint').textContent = 'Allow camera access when your browser asks.';
  $('pastePairingText').value = '';
  setHidden($('scannerModal'), false);

  if (!window.isSecureContext) {
    $('scanProgressText').textContent = 'Camera requires the secure HTTPS website.';
    $('scanHint').textContent = 'Open the GitHub Pages address in Chrome or Safari—not the repository preview.';
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    $('scanProgressText').textContent = 'This in-app browser cannot use the camera.';
    $('scanHint').textContent = 'Open this page in Chrome, Samsung Internet, Edge, or Safari.';
    return;
  }

  try {
    // ZXing is the primary scanner because BarcodeDetector is missing in many browsers.
    try {
      await startZxingScanner();
      $('scanProgressText').textContent = 'Camera ready—looking for QR frames…';
      $('scanHint').textContent = 'Fill the square with the QR code and hold both devices steady.';
      return;
    } catch (zxingError) {
      console.warn('ZXing unavailable; trying native detector', zxingError);
    }

    if ('BarcodeDetector' in window) {
      await startNativeScanner();
      $('scanProgressText').textContent = 'Camera ready—looking for QR frames…';
      $('scanHint').textContent = 'Fill the square with the QR code and hold both devices steady.';
      return;
    }

    throw new Error('No compatible QR scanner is available in this browser.');
  } catch (error) {
    console.error(error);
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
    const unavailable = error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError';
    $('scanProgressText').textContent = denied
      ? 'Camera permission was blocked.'
      : unavailable
        ? 'No camera was found.'
        : 'Camera could not start.';
    $('scanHint').textContent = denied
      ? 'Allow camera permission in the browser site settings, then tap Scan again.'
      : `${error.message || 'Open the page in your regular browser and try again.'}`;
  }
};

stopScanner = async function stopCompatibleScanner() {
  state.scan.active = false;

  if (state.scan.animationFrame) cancelAnimationFrame(state.scan.animationFrame);
  state.scan.animationFrame = null;

  try { state.scan.controls?.stop(); } catch {}
  state.scan.controls = null;
  state.scan.zxingReader = null;

  state.scan.stream?.getTracks().forEach(track => track.stop());
  state.scan.stream = null;

  const video = $('cameraVideo');
  if (video) {
    const stream = video.srcObject;
    if (stream?.getTracks) stream.getTracks().forEach(track => track.stop());
    video.pause();
    video.srcObject = null;
  }

  setHidden($('scannerModal'), true);
};

// Existing close handlers captured the old stop function, so add a handler for the replacement too.
$('closeScannerBtn')?.addEventListener('click', () => stopScanner());

// Better defaults for animated QR capture on mobile cameras.
for (const id of ['senderSpeed', 'answerSpeed', 'directSpeed']) {
  const control = $(id);
  if (control && Number(control.value) < 520) control.value = '620';
}

if ($('secureBadge')) $('secureBadge').textContent = 'Works over cellular or Wi-Fi';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
