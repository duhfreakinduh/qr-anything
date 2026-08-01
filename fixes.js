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

(function initShareAppFeature() {
  const APP_URL = 'https://duhfreakinduh.github.io/qr-anything/';
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.getElementById('shareAppBtn')) return;

  const style = document.createElement('style');
  style.id = 'shareAppStyles';
  style.textContent = `
    .topbar-actions { display: flex; align-items: center; gap: .55rem; }
    .share-app-trigger {
      min-height: 38px;
      padding: .5rem .78rem;
      border: 1px solid rgba(86,168,255,.45);
      border-radius: .72rem;
      background: rgba(86,168,255,.11);
      color: #dcecff;
      font-weight: 800;
    }
    .share-app-trigger:hover, .share-app-trigger:focus-visible {
      border-color: #56a8ff;
      background: rgba(86,168,255,.2);
      outline: none;
    }
    .share-app-card { width: min(500px, 100%); text-align: center; }
    .share-app-card .modal-header { text-align: left; }
    .share-app-qr { min-height: 0; width: min(320px, 100%); margin: 1rem auto .8rem; }
    .share-app-qr img, .share-app-qr canvas { width: 100% !important; max-width: 280px; }
    .share-app-copy { margin: 0 auto 1rem; color: var(--muted); line-height: 1.55; }
    .share-app-url {
      width: 100%;
      margin: 0 0 1rem;
      padding: .8rem .9rem;
      border: 1px solid var(--border);
      border-radius: .75rem;
      background: #050b14;
      color: var(--text);
      text-align: center;
    }
    .share-app-actions { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: .65rem; }
    body.share-app-open { overflow: hidden; }
    @media (max-width: 700px) {
      .topbar-actions .badge { display: none; }
      .share-app-trigger { padding-inline: .65rem; }
    }
    @media (max-width: 520px) {
      .share-app-actions { grid-template-columns: 1fr; }
      .brand small { display: none; }
    }
  `;
  document.head.appendChild(style);

  const shareButton = document.createElement('button');
  shareButton.id = 'shareAppBtn';
  shareButton.className = 'share-app-trigger';
  shareButton.type = 'button';
  shareButton.setAttribute('aria-haspopup', 'dialog');
  shareButton.setAttribute('aria-controls', 'shareAppModal');
  shareButton.textContent = '▦ Share app';

  const actions = document.createElement('div');
  actions.className = 'topbar-actions';
  const badge = document.getElementById('secureBadge');
  topbar.appendChild(actions);
  actions.appendChild(shareButton);
  if (badge) actions.appendChild(badge);

  const modal = document.createElement('div');
  modal.id = 'shareAppModal';
  modal.className = 'modal hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'shareAppTitle');
  modal.innerHTML = `
    <div class="modal-card share-app-card">
      <div class="modal-header">
        <div>
          <p class="step">SHARE QR ANYTHING</p>
          <h2 id="shareAppTitle">Let someone scan to open the app</h2>
        </div>
        <button id="closeShareAppBtn" class="icon-button" type="button" aria-label="Close share app window">×</button>
      </div>
      <div id="shareAppQr" class="qr-box share-app-qr" aria-label="QR code linking to QR Anything"></div>
      <p class="share-app-copy">Scan this code with any phone camera. It opens the live QR Anything app—no download or account required.</p>
      <input id="shareAppUrl" class="share-app-url" type="url" readonly aria-label="QR Anything app link" />
      <div class="share-app-actions">
        <button id="nativeShareAppBtn" class="primary" type="button">Share link</button>
        <button id="copyShareAppBtn" class="secondary" type="button">Copy link</button>
        <button id="saveShareAppQrBtn" class="secondary" type="button">Save QR</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const qrBox = document.getElementById('shareAppQr');
  const urlField = document.getElementById('shareAppUrl');
  const closeButton = document.getElementById('closeShareAppBtn');
  let lastFocused = null;
  let qrRendered = false;

  function renderShareQr() {
    if (qrRendered || !qrBox) return;
    if (typeof QRCode === 'undefined') {
      qrBox.innerHTML = '<p style="color:#111;text-align:center">QR library did not load. Copy the link below instead.</p>';
      return;
    }

    qrBox.innerHTML = '';
    new QRCode(qrBox, {
      text: APP_URL,
      width: 280,
      height: 280,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    const image = qrBox.querySelector('img');
    if (image) image.alt = 'QR code that opens QR Anything';
    qrRendered = true;
  }

  function openShareApp() {
    lastFocused = document.activeElement;
    urlField.value = APP_URL;
    setHidden(modal, false);
    document.body.classList.add('share-app-open');
    requestAnimationFrame(() => {
      renderShareQr();
      closeButton.focus();
    });
  }

  function closeShareApp() {
    setHidden(modal, true);
    document.body.classList.remove('share-app-open');
    lastFocused?.focus?.();
  }

  async function shareAppLink() {
    if (!navigator.share) {
      await copyText(APP_URL);
      return;
    }
    try {
      await navigator.share({
        title: 'QR Anything',
        text: 'Open QR Anything to privately transfer messages and files between devices.',
        url: APP_URL
      });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error(error);
        toast('Could not open the share menu. The link was copied instead.');
        await copyText(APP_URL);
      }
    }
  }

  function saveShareQr() {
    const canvas = qrBox.querySelector('canvas');
    const image = qrBox.querySelector('img');
    const finish = href => {
      const link = document.createElement('a');
      link.href = href;
      link.download = 'qr-anything-app.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast('QR image saved');
    };

    if (canvas?.toBlob) {
      canvas.toBlob(blob => {
        if (!blob) return toast('Could not create the QR image.');
        const objectUrl = URL.createObjectURL(blob);
        finish(objectUrl);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }, 'image/png');
      return;
    }

    if (image?.src) {
      finish(image.src);
      return;
    }

    toast('Open the share window again and wait for the QR code.');
  }

  shareButton.addEventListener('click', openShareApp);
  closeButton.addEventListener('click', closeShareApp);
  modal.addEventListener('click', event => {
    if (event.target === modal) closeShareApp();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeShareApp();
  });
  document.getElementById('nativeShareAppBtn').addEventListener('click', shareAppLink);
  document.getElementById('copyShareAppBtn').addEventListener('click', () => copyText(APP_URL));
  document.getElementById('saveShareAppQrBtn').addEventListener('click', saveShareQr);
})();
