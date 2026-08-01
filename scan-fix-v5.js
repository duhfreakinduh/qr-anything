'use strict';

// QR capture reliability improvements.
// Pairing data is split into smaller, less-dense QR codes and each frame stays
// visible longer. A native BarcodeDetector runs alongside ZXing when available.

const V5_PAIR_CHUNK_SIZE = 190;
const V5_DIRECT_CHUNK_SIZE = 320;
const V5_PAIR_FRAME_MS = 900;
const V5_DIRECT_FRAME_MS = 1050;

const v4MakeFrames = makeFrames;
makeFrames = async function makeEasyScanFrames(kind, text, chunkSize) {
  let safeChunkSize = chunkSize;
  if (kind === 'offer' || kind === 'answer') safeChunkSize = V5_PAIR_CHUNK_SIZE;
  if (kind === 'direct') safeChunkSize = Math.min(Number(chunkSize) || V5_DIRECT_CHUNK_SIZE, V5_DIRECT_CHUNK_SIZE);
  return v4MakeFrames(kind, text, safeChunkSize);
};

const v4AnimatorStart = QrAnimator.prototype.start;
QrAnimator.prototype.start = function startReadableFrames(frames) {
  const first = String(frames?.[0] || '');
  const isPairing = first.includes('|offer|') || first.includes('|answer|');
  const minimum = isPairing ? V5_PAIR_FRAME_MS : V5_DIRECT_FRAME_MS;
  if (this.speedControl && Number(this.speedControl.value) < minimum) {
    this.speedControl.value = String(minimum);
  }
  v4AnimatorStart.call(this, frames);
};

QrAnimator.prototype.render = function renderCrispQr() {
  if (!this.frames.length) return;
  if (typeof QRCode === 'undefined') {
    this.container.innerHTML = '<p style="color:#111;text-align:center">QR library did not load. Reload the page.</p>';
    return;
  }

  this.container.innerHTML = '';
  const outerWidth = Math.max(270, Math.min(430, this.container.clientWidth || 380));
  const quietZone = 22;
  const qrSize = Math.max(230, outerWidth - (quietZone * 2));
  const holder = document.createElement('div');
  holder.className = 'v5-qr-holder';
  holder.style.cssText = `display:inline-block;background:#fff;padding:${quietZone}px;border-radius:12px;line-height:0;`;
  this.container.appendChild(holder);

  try {
    new QRCode(holder, {
      text: this.frames[this.index],
      width: qrSize,
      height: qrSize,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
    holder.querySelectorAll('canvas,img').forEach(element => {
      element.style.imageRendering = 'pixelated';
      element.style.maxWidth = 'none';
    });
    if (this.counter) this.counter.textContent = `Frame ${this.index + 1} / ${this.frames.length}`;
  } catch (error) {
    console.error(error);
    this.container.innerHTML = '<p style="color:#111;text-align:center">This QR frame could not be drawn. Recreate the pairing code.</p>';
  }
};

const v4ConsumeScannedQr = consumeScannedQr;
consumeScannedQr = async function consumeTrimmedQr(raw) {
  const cleaned = typeof raw === 'string' ? raw.trim() : raw;
  if (cleaned && state.scan.active) {
    state.scan.lastQrDetectedAt = Date.now();
  }
  return v4ConsumeScannedQr(cleaned);
};

const v4StartZxingScanner = startZxingScanner;
startZxingScanner = async function startDualScanner() {
  await v4StartZxingScanner();

  const video = $('cameraVideo');
  const track = video?.srcObject?.getVideoTracks?.()[0];
  if (track?.getCapabilities && track?.applyConstraints) {
    try {
      const capabilities = track.getCapabilities();
      const advanced = [];
      if (capabilities.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
      if (advanced.length) await track.applyConstraints({ advanced });
    } catch (error) {
      console.debug('Camera focus setting was not available', error);
    }
  }

  if (!('BarcodeDetector' in window)) return;

  try {
    state.scan.assistDetector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (error) {
    console.debug('Native QR assist unavailable', error);
    return;
  }

  const assistLoop = async () => {
    if (!state.scan.active) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await state.scan.assistDetector.detect(video);
        for (const code of codes) await consumeScannedQr(code.rawValue);
      }
    } catch (error) {
      if (state.scan.active) console.debug('Native QR assist retry', error);
    }
    if (state.scan.active) state.scan.assistAnimationFrame = requestAnimationFrame(assistLoop);
  };
  assistLoop();
};

const v4StopScanner = stopScanner;
stopScanner = async function stopAllScanners() {
  if (state.scan.assistAnimationFrame) cancelAnimationFrame(state.scan.assistAnimationFrame);
  state.scan.assistAnimationFrame = null;
  state.scan.assistDetector = null;
  return v4StopScanner();
};

// Replace the older same-Wi-Fi timeout wording. TURN relay remains enabled, so
// the devices may use cellular data or completely different internet networks.
const v4AcceptReceiverAnswer = acceptReceiverAnswer;
acceptReceiverAnswer = async function acceptInternetReceiverAnswer(text) {
  await v4AcceptReceiverAnswer(text);
  clearTimeout(state.connectionTimer);
  state.connectionTimer = setTimeout(() => {
    if (state.channel?.readyState === 'open' || state.pc?.connectionState === 'connected') return;
    $('senderStatus').textContent = 'Internet connection timed out. Recreate both pairing codes and try again.';
    toast('Connection timed out. Keep both pages open and recreate the pairing codes.', 7000);
  }, 45000);
};

const v4AcceptSenderOffer = acceptSenderOffer;
acceptSenderOffer = async function acceptInternetSenderOffer(text) {
  await v4AcceptSenderOffer(text);
  clearTimeout(state.connectionTimer);
  state.connectionTimer = setTimeout(() => {
    if (state.channel?.readyState === 'open' || state.pc?.connectionState === 'connected') return;
    $('receiverStatus').textContent = 'Internet connection timed out. Recreate both pairing codes and try again.';
  }, 45000);
};

(function addQrReadabilityStyles() {
  const style = document.createElement('style');
  style.id = 'v5QrReadabilityStyles';
  style.textContent = `
    #senderQr, #answerQr, #directQr {
      width: min(430px, 100%);
      max-width: 100%;
      margin-inline: auto;
      overflow: visible;
      background: transparent;
    }
    .v5-qr-holder canvas, .v5-qr-holder img {
      display: block !important;
      image-rendering: pixelated;
    }
    .camera-wrap video { object-fit: cover; }
    .scan-guide { border-width: 4px; }
  `;
  document.head.appendChild(style);
})();

for (const [id, value] of [['senderSpeed', V5_PAIR_FRAME_MS], ['answerSpeed', V5_PAIR_FRAME_MS], ['directSpeed', V5_DIRECT_FRAME_MS]]) {
  const control = $(id);
  if (control) control.value = String(value);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => registration.update()).catch(() => {});
}
