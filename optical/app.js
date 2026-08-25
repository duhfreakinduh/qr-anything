'use strict';

import {
  FountainEncoder,
  FountainDecoder,
  formatBytes,
  sha256Hex
} from './core.js?v=10';

const $ = id => document.getElementById(id);
const PROFILES = {
  safe: { blockSize: 240, fps: 8 },
  standard: { blockSize: 480, fps: 12 },
  fast: { blockSize: 800, fps: 15 },
  turbo: { blockSize: 1100, fps: 18 }
};

const state = {
  sender: {
    running: false,
    encoder: null,
    timer: null,
    nextAt: 0,
    startedAt: 0,
    frames: 0,
    frameTimes: []
  },
  receiver: {
    running: false,
    stream: null,
    detector: null,
    decoder: new FountainDecoder(),
    loopHandle: null,
    scanBusy: false,
    startAt: 0,
    captureFrames: 0,
    decodedFrames: 0,
    lastStatsAt: 0,
    lastSolved: 0,
    lastGoodputAt: 0,
    objectUrl: null,
    completed: false,
    wakeLock: null
  }
};

function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), ms);
}

function setMode(mode) {
  const send = mode === 'send';
  $('showSend').classList.toggle('active', send);
  $('showReceive').classList.toggle('active', !send);
  $('sendPanel').classList.toggle('active', send);
  $('receivePanel').classList.toggle('active', !send);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('showSend').addEventListener('click', () => setMode('send'));
$('showReceive').addEventListener('click', () => setMode('receive'));

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return null;
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (state.sender.running && !state.sender.wakeLock) state.sender.wakeLock = await requestWakeLock();
  if (state.receiver.running && !state.receiver.wakeLock) state.receiver.wakeLock = await requestWakeLock();
});

async function gzipIfUseful(bytes) {
  if (!('CompressionStream' in window) || bytes.length < 4096) return { bytes, compressed: false };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    if (compressed.length + 128 < bytes.length * 0.96) return { bytes: compressed, compressed: true };
  } catch {}
  return { bytes, compressed: false };
}

async function gunzip(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('This browser cannot decompress the received file.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function renderQrToCanvas(text, canvas) {
  if (typeof window.qrcode !== 'function') throw new Error('QR renderer did not load. Reload while online.');
  const qr = window.qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();

  const count = qr.getModuleCount();
  const quiet = 4;
  const logical = count + quiet * 2;
  const target = 720;
  const module = Math.max(1, Math.floor(target / logical));
  const size = logical * module;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) ctx.fillRect((col + quiet) * module, (row + quiet) * module, module, module);
    }
  }
  return count;
}

function profile() {
  return PROFILES[$('speedProfile').value] || PROFILES.standard;
}

function updateSenderStats(frameInfo, frameMs) {
  const sender = state.sender;
  const elapsed = Math.max(0.001, (performance.now() - sender.startedAt) / 1000);
  sender.frameTimes.push(frameMs);
  if (sender.frameTimes.length > 30) sender.frameTimes.shift();
  $('txFps').textContent = (sender.frames / elapsed).toFixed(1);
  $('txFrame').textContent = String(sender.frames);
  $('txBlock').textContent = `${sender.encoder.blockSize} B`;
  $('txBlocks').textContent = String(sender.encoder.k);
  $('txPayload').textContent = formatBytes(sender.encoder.payload.length);
  $('txRate').textContent = `${((sender.encoder.blockSize * sender.frames / elapsed) / 1024).toFixed(1)} KB/s raw`;
  const phase = (sender.frames % Math.max(1, sender.encoder.k)) / Math.max(1, sender.encoder.k);
  $('sendMeterFill').style.width = `${Math.round(phase * 100)}%`;
  $('sendStatus').textContent = frameInfo.kind === 'metadata'
    ? `Broadcasting metadata • ${sender.encoder.k} source blocks • receiver may start anytime`
    : `Broadcasting fountain frame ${sender.frames} • degree ${frameInfo.degree} • keep receiver camera pointed at screen`;
}

function senderTick() {
  if (!state.sender.running || !state.sender.encoder) return;
  const p = profile();
  const interval = 1000 / p.fps;
  const started = performance.now();
  try {
    const frame = state.sender.encoder.nextFrame();
    renderQrToCanvas(frame.text, $('opticalQr'));
    state.sender.frames += 1;
    updateSenderStats(frame, performance.now() - started);
  } catch (error) {
    console.error(error);
    $('sendStatus').textContent = `Stopped: ${error.message}`;
    stopSending();
    toast(error.message, 5000);
    return;
  }

  const now = performance.now();
  if (!state.sender.nextAt) state.sender.nextAt = now + interval;
  else state.sender.nextAt += interval;
  const wait = Math.max(0, state.sender.nextAt - performance.now());
  state.sender.timer = setTimeout(senderTick, wait);
}

async function startSending() {
  const file = $('sendFile').files?.[0];
  if (!file) return toast('Choose a file first.');
  if (state.sender.running) return;

  $('startSend').disabled = true;
  $('sendStatus').textContent = 'Preparing file…';
  try {
    const original = new Uint8Array(await file.arrayBuffer());
    const packed = await gzipIfUseful(original);
    const hash = await sha256Hex(original);
    const p = profile();
    const encoder = new FountainEncoder(packed.bytes, {
      name: file.name,
      type: file.type || 'application/octet-stream',
      originalSize: original.length,
      payloadSize: packed.bytes.length,
      compressed: packed.compressed,
      sha256: hash
    }, p.blockSize);
    encoder.setMetadataCadence(Math.max(8, Math.round(p.fps * 1.5)));
    state.sender.encoder = encoder;
    state.sender.running = true;
    state.sender.startedAt = performance.now();
    state.sender.frames = 0;
    state.sender.nextAt = 0;
    state.sender.frameTimes = [];
    state.sender.wakeLock = await requestWakeLock();
    $('stopSend').disabled = false;
    $('speedProfile').disabled = true;
    $('sendFile').disabled = true;
    $('sendStatus').textContent = `Prepared ${file.name} • ${formatBytes(original.length)}${packed.compressed ? ` → ${formatBytes(packed.bytes.length)} gzip` : ''}`;
    senderTick();
  } catch (error) {
    console.error(error);
    $('startSend').disabled = false;
    $('sendStatus').textContent = error.message;
    toast(`Could not start: ${error.message}`, 5000);
  }
}

async function stopSending() {
  state.sender.running = false;
  clearTimeout(state.sender.timer);
  state.sender.timer = null;
  state.sender.nextAt = 0;
  try { await state.sender.wakeLock?.release(); } catch {}
  state.sender.wakeLock = null;
  $('startSend').disabled = false;
  $('stopSend').disabled = true;
  $('speedProfile').disabled = false;
  $('sendFile').disabled = false;
  if (state.sender.encoder) $('sendStatus').textContent = `Stream stopped after ${state.sender.frames} QR frames.`;
}

$('startSend').addEventListener('click', startSending);
$('stopSend').addEventListener('click', stopSending);
$('fullScreenQr').addEventListener('click', async () => {
  const stage = $('senderStage');
  try {
    if (!document.fullscreenElement) await stage.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    toast('Fullscreen is not available in this browser.');
  }
});

function loadJsQr() {
  if (typeof window.jsQR === 'function') return Promise.resolve();
  if (window.__opticalJsQr) return window.__opticalJsQr;
  const urls = [
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js'
  ];
  window.__opticalJsQr = new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return reject(new Error('QR camera decoder could not load. Connect once and reload.'));
      const script = document.createElement('script');
      script.src = urls[i++];
      script.crossOrigin = 'anonymous';
      script.onload = () => typeof window.jsQR === 'function' ? resolve() : next();
      script.onerror = next;
      document.head.appendChild(script);
    };
    next();
  });
  return window.__opticalJsQr;
}

async function openCamera() {
  const constraintsList = [
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } } },
    { audio: false, video: { facingMode: 'environment' } },
    { audio: false, video: true }
  ];
  let last;
  for (const constraints of constraintsList) {
    try { return await navigator.mediaDevices.getUserMedia(constraints); }
    catch (error) { last = error; if (error?.name === 'NotAllowedError') throw error; }
  }
  throw last || new Error('Camera unavailable.');
}

function resetReceiverStats() {
  $('captureFps').textContent = '0';
  $('decodeFps').textContent = '0';
  $('rxLock').textContent = '—';
  $('rxDropped').textContent = '0';
  $('rxGoodput').textContent = '0 KB/s';
  $('rxElapsed').textContent = '0 s';
  $('rxFrames').textContent = '0/0/0';
  $('rxSession').textContent = '—';
  $('rxBlock').textContent = '—';
  $('rxPayload').textContent = '—';
  $('receiveMeterFill').style.width = '0%';
  $('lockChip').textContent = 'NO LOCK';
  $('lockChip').classList.add('idle');
}

function updateReceiverUi() {
  const r = state.receiver;
  const d = r.decoder;
  const stats = d.stats();
  const elapsed = r.startAt ? Math.max(0.001, (performance.now() - r.startAt) / 1000) : 0;
  $('captureFps').textContent = elapsed ? (r.captureFrames / elapsed).toFixed(1) : '0';
  $('decodeFps').textContent = elapsed ? (r.decodedFrames / elapsed).toFixed(1) : '0';
  $('rxLock').textContent = d.metadata ? 'LOCK' : '—';
  $('lockChip').textContent = d.metadata ? 'LOCK' : 'NO LOCK';
  $('lockChip').classList.toggle('idle', !d.metadata);
  $('rxDropped').textContent = String(stats.framesBad);
  $('rxElapsed').textContent = `${elapsed.toFixed(1)} s`;
  $('rxFrames').textContent = `${stats.framesNew}/${stats.framesDuplicate}/${stats.framesBad}`;
  $('rxSession').textContent = stats.session ? stats.session.slice(-4) : '—';
  $('rxBlock').textContent = d.metadata ? `${d.blockSize} B` : '—';
  $('rxPayload').textContent = d.metadata ? formatBytes(Number(d.metadata.originalSize || d.metadata.payloadSize || 0)) : '—';
  $('receiveMeterFill').style.width = `${stats.percent}%`;

  if (d.metadata) {
    const solvedBytes = Math.min(Number(d.metadata.payloadSize || 0), stats.solved * d.blockSize);
    $('rxGoodput').textContent = elapsed ? `${(solvedBytes / elapsed / 1024).toFixed(1)} KB/s` : '0 KB/s';
    $('receiveStatus').textContent = stats.complete
      ? 'All source blocks recovered. Verifying file…'
      : `LOCK • recovered ${stats.solved}/${stats.total} source blocks (${stats.percent}%) • keep camera steady`;
  }
}

async function completeReceive() {
  const r = state.receiver;
  if (r.completed || !r.decoder.complete) return;
  r.completed = true;
  try {
    let bytes = r.decoder.assemblePayload();
    if (r.decoder.metadata.compressed) bytes = await gunzip(bytes);
    const hash = await sha256Hex(bytes);
    if (r.decoder.metadata.sha256 && hash !== r.decoder.metadata.sha256) {
      throw new Error('Integrity check failed. Reset and receive the stream again.');
    }

    const meta = r.decoder.metadata;
    const blob = new Blob([bytes], { type: meta.type || 'application/octet-stream' });
    if (r.objectUrl) URL.revokeObjectURL(r.objectUrl);
    r.objectUrl = URL.createObjectURL(blob);
    $('saveResult').href = r.objectUrl;
    $('saveResult').download = meta.name || 'received-file';
    const elapsed = Math.max(0.001, (performance.now() - r.startAt) / 1000);
    $('resultTitle').textContent = `✓ TRANSFER COMPLETE — ${meta.name || 'file'}`;
    $('resultDetail').textContent = `${formatBytes(bytes.length)} in ${elapsed.toFixed(1)} s • SHA-256 verified • ${(bytes.length / elapsed / 1024).toFixed(1)} KB/s useful rate`;
    $('receiveResult').classList.remove('hidden');
    renderPreview(blob, r.objectUrl, meta.type);
    $('receiveStatus').textContent = 'Transfer complete and verified. The sender can stop now.';
    toast('Optical transfer complete!', 5000);
    await stopReceiving(false);
  } catch (error) {
    r.completed = false;
    $('receiveStatus').textContent = error.message;
    toast(error.message, 6000);
  }
}

function renderPreview(blob, url, type = '') {
  const box = $('resultPreview');
  box.innerHTML = '';
  let element = null;
  if (type.startsWith('image/')) {
    element = document.createElement('img');
    element.src = url;
    element.alt = 'Received file preview';
  } else if (type.startsWith('video/')) {
    element = document.createElement('video');
    element.src = url;
    element.controls = true;
    element.playsInline = true;
  } else if (type.startsWith('audio/')) {
    element = document.createElement('audio');
    element.src = url;
    element.controls = true;
  }
  if (element) box.appendChild(element);
}

async function consumeOpticalText(text) {
  const before = state.receiver.decoder.solved.size;
  const result = state.receiver.decoder.acceptText(text);
  if (result.accepted) state.receiver.decodedFrames += 1;
  updateReceiverUi();
  if (state.receiver.decoder.solved.size > before) state.receiver.lastSolved = state.receiver.decoder.solved.size;
  if (state.receiver.decoder.complete) await completeReceive();
}

async function scanCanvasFrame(video, canvas, context) {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (!sourceW || !sourceH) return;

  // Crop the center 86% so the decoder spends pixels on the QR, not the room.
  const cropScale = 0.86;
  const cropW = Math.round(sourceW * cropScale);
  const cropH = Math.round(sourceH * cropScale);
  const sx = Math.round((sourceW - cropW) / 2);
  const sy = Math.round((sourceH - cropH) / 2);
  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / cropW);
  const width = Math.max(1, Math.round(cropW * scale));
  const height = Math.max(1, Math.round(cropH * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(video, sx, sy, cropW, cropH, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const decoded = window.jsQR(pixels.data, width, height, { inversionAttempts: 'dontInvert' });
  if (decoded?.data) await consumeOpticalText(decoded.data);
}

async function scanLoop() {
  const r = state.receiver;
  if (!r.running) return;
  const video = $('receiveVideo');
  const canvas = $('scanCanvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  r.captureFrames += 1;

  if (!r.scanBusy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    r.scanBusy = true;
    try {
      let nativeHit = false;
      if (r.detector) {
        try {
          const codes = await r.detector.detect(video);
          for (const code of codes) {
            if (!code.rawValue?.startsWith('QRO1')) continue;
            nativeHit = true;
            await consumeOpticalText(code.rawValue);
          }
        } catch {}
      }
      if (!nativeHit && typeof window.jsQR === 'function') await scanCanvasFrame(video, canvas, context);
    } catch (error) {
      console.debug('Optical scan retry', error);
    } finally {
      r.scanBusy = false;
    }
  }

  updateReceiverUi();
  if (r.running) r.loopHandle = requestAnimationFrame(scanLoop);
}

async function startReceiving() {
  if (state.receiver.running) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return toast('Open the HTTPS site directly in Chrome, Samsung Internet, or Safari.', 6000);
  }
  $('startReceive').disabled = true;
  $('receiveStatus').textContent = 'Starting camera and QR decoder…';
  try {
    const [stream] = await Promise.all([openCamera(), loadJsQr()]);
    const video = $('receiveVideo');
    state.receiver.stream = stream;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    if ('BarcodeDetector' in window) {
      try { state.receiver.detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { state.receiver.detector = null; }
    }

    const track = stream.getVideoTracks()[0];
    try {
      const caps = track?.getCapabilities?.();
      const advanced = [];
      if (caps?.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
      if (advanced.length) await track.applyConstraints({ advanced });
    } catch {}

    state.receiver.running = true;
    state.receiver.completed = false;
    state.receiver.startAt = performance.now();
    state.receiver.captureFrames = 0;
    state.receiver.decodedFrames = 0;
    state.receiver.wakeLock = await requestWakeLock();
    $('startReceive').disabled = true;
    $('stopReceive').disabled = false;
    $('receiveStatus').textContent = 'Camera ready. Fill the green box with the sender QR stream.';
    scanLoop();
  } catch (error) {
    console.error(error);
    $('startReceive').disabled = false;
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
    $('receiveStatus').textContent = denied ? 'Camera permission was denied. Allow camera access and try again.' : error.message;
    toast($('receiveStatus').textContent, 6000);
  }
}

async function stopReceiving(updateStatus = true) {
  const r = state.receiver;
  r.running = false;
  if (r.loopHandle) cancelAnimationFrame(r.loopHandle);
  r.loopHandle = null;
  r.stream?.getTracks?.().forEach(track => track.stop());
  r.stream = null;
  const video = $('receiveVideo');
  try { video.pause(); } catch {}
  video.srcObject = null;
  try { await r.wakeLock?.release(); } catch {}
  r.wakeLock = null;
  $('startReceive').disabled = false;
  $('stopReceive').disabled = true;
  if (updateStatus && !r.completed) $('receiveStatus').textContent = 'Camera stopped. Progress is kept; tap Start Camera to continue this session.';
}

function resetReceiving() {
  stopReceiving(false);
  state.receiver.decoder.reset();
  state.receiver.completed = false;
  state.receiver.startAt = 0;
  state.receiver.captureFrames = 0;
  state.receiver.decodedFrames = 0;
  if (state.receiver.objectUrl) URL.revokeObjectURL(state.receiver.objectUrl);
  state.receiver.objectUrl = null;
  $('receiveResult').classList.add('hidden');
  $('resultPreview').innerHTML = '';
  resetReceiverStats();
  $('receiveStatus').textContent = 'Reset. Start the camera and point it at a sender stream.';
}

$('startReceive').addEventListener('click', startReceiving);
$('stopReceive').addEventListener('click', () => stopReceiving(true));
$('resetReceive').addEventListener('click', resetReceiving);
$('shareResult').addEventListener('click', async () => {
  const r = state.receiver;
  if (!r.objectUrl || !r.decoder.metadata) return;
  try {
    const response = await fetch(r.objectUrl);
    const blob = await response.blob();
    const file = new File([blob], r.decoder.metadata.name || 'received-file', { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Received with QR Anything Optical' });
    else toast('Use Save File, then share it from your Downloads/Files app.');
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Could not open the share sheet. Use Save File instead.');
  }
});

resetReceiverStats();
