'use strict';

function sendJson(payload) {
  if (!state.channel || state.channel.readyState !== 'open') throw new Error('The transfer connection is not open.');
  state.channel.send(JSON.stringify(payload));
}

function waitForBuffer(channel) {
  if (channel.bufferedAmount <= HIGH_WATER_MARK) return Promise.resolve();
  return new Promise(resolve => {
    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow, { once: true });
    setTimeout(() => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    }, 1500);
  });
}

function updateSendProgress(sent, total, detail) {
  const percent = total ? Math.min(100, Math.round((sent / total) * 100)) : 100;
  $('sendProgress').value = percent;
  $('sendProgressPercent').textContent = `${percent}%`;
  $('sendProgressDetail').textContent = `${detail} • ${formatBytes(sent)} of ${formatBytes(total)}`;
}

async function sendTransfer() {
  state.transferStarted = true;
  const payload = state.senderPayload;
  if (!payload) throw new Error('Nothing is prepared to send.');
  const messageBytes = encoder.encode(payload.message).byteLength;
  const fileBytes = payload.files.reduce((sum, file) => sum + file.size, 0);
  const totalBytes = messageBytes + fileBytes;
  let sentBytes = 0;

  setHidden($('sendProgressCard'), false);
  $('sendProgressTitle').textContent = 'Sending securely…';
  updateSendProgress(0, totalBytes, 'Starting');

  sendJson({
    t: 'manifest',
    v: 1,
    transferId: randomId(),
    totalBytes,
    messageBytes,
    files: payload.files.map((file, index) => ({ id: `${index}-${randomId(6)}`, name: file.name, type: file.type, size: file.size }))
  });

  if (payload.message) {
    sendJson({ t: 'message', text: payload.message });
    sentBytes += messageBytes;
    updateSendProgress(sentBytes, totalBytes, 'Message sent');
  }

  for (let fileIndex = 0; fileIndex < payload.files.length; fileIndex += 1) {
    const file = payload.files[fileIndex];
    const id = `${fileIndex}-${randomId(6)}`;
    sendJson({ t: 'file-start', id, name: file.name, type: file.type || 'application/octet-stream', size: file.size });

    for (let offset = 0; offset < file.size; offset += DATA_CHUNK_SIZE) {
      const buffer = await file.slice(offset, offset + DATA_CHUNK_SIZE).arrayBuffer();
      await waitForBuffer(state.channel);
      state.channel.send(buffer);
      sentBytes += buffer.byteLength;
      updateSendProgress(sentBytes, totalBytes, `Sending ${file.name}`);
    }
    sendJson({ t: 'file-end', id });
  }

  sendJson({ t: 'done' });
  updateSendProgress(totalBytes, totalBytes, 'Transfer complete');
  $('sendProgressTitle').textContent = 'Transfer complete';
  $('senderStatus').textContent = 'Everything was sent successfully.';
  toast('Transfer complete');
}

function handleTransferError(error) {
  console.error(error);
  state.transferStarted = false;
  $('sendProgressTitle').textContent = 'Transfer stopped';
  $('sendProgressDetail').textContent = error.message;
  toast(`Transfer failed: ${error.message}`, 5000);
}

function updateReceiveProgress(detail = '') {
  const incoming = state.incoming;
  if (!incoming) return;
  const percent = incoming.totalBytes ? Math.min(100, Math.round((incoming.receivedBytes / incoming.totalBytes) * 100)) : 0;
  $('receiveProgress').value = percent;
  $('receiveProgressPercent').textContent = `${percent}%`;
  $('receiveProgressDetail').textContent = `${detail} • ${formatBytes(incoming.receivedBytes)} of ${formatBytes(incoming.totalBytes)}`;
}

function renderReceivedMessage(text) {
  const card = document.createElement('article');
  card.className = 'received-card message';
  const heading = document.createElement('strong');
  heading.textContent = 'Message received';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  card.append(heading, paragraph);
  $('receivedItems').prepend(card);
}

function renderReceivedFile(meta, blob) {
  const card = document.createElement('article');
  card.className = 'received-card';
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = fileTypeLabel({ name: meta.name, type: meta.type });
  const fileMeta = document.createElement('span');
  fileMeta.className = 'file-meta';
  const strong = document.createElement('strong');
  strong.textContent = meta.name;
  const sub = document.createElement('span');
  sub.textContent = `${formatBytes(blob.size)} • ${meta.type || 'Unknown type'}`;
  fileMeta.append(strong, sub);
  const link = document.createElement('a');
  link.className = 'download-link';
  link.textContent = 'Save file';
  link.download = meta.name || 'download';
  link.href = URL.createObjectURL(blob);
  card.append(icon, fileMeta, link);
  $('receivedItems').prepend(card);
}

function handleIncomingMessage(event) {
  if (typeof event.data === 'string') {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    switch (payload.t) {
      case 'manifest':
        state.incoming = {
          totalBytes: payload.totalBytes || 0,
          receivedBytes: 0,
          currentFile: null,
          completedFiles: 0
        };
        setHidden($('receiveProgressCard'), false);
        $('receiveProgressTitle').textContent = 'Receiving securely…';
        updateReceiveProgress('Transfer started');
        break;
      case 'message': {
        renderReceivedMessage(payload.text || '');
        if (state.incoming) state.incoming.receivedBytes += encoder.encode(payload.text || '').byteLength;
        updateReceiveProgress('Message received');
        break;
      }
      case 'file-start':
        if (!state.incoming) state.incoming = { totalBytes: payload.size || 0, receivedBytes: 0 };
        state.incoming.currentFile = {
          id: payload.id,
          name: payload.name || 'download',
          type: payload.type || 'application/octet-stream',
          size: payload.size || 0,
          received: 0,
          chunks: []
        };
        updateReceiveProgress(`Receiving ${payload.name}`);
        break;
      case 'file-end': {
        const file = state.incoming?.currentFile;
        if (!file || file.id !== payload.id) return;
        const blob = new Blob(file.chunks, { type: file.type });
        renderReceivedFile(file, blob);
        state.incoming.currentFile = null;
        state.incoming.completedFiles += 1;
        updateReceiveProgress(`${file.name} received`);
        break;
      }
      case 'done':
        if (state.incoming) state.incoming.receivedBytes = state.incoming.totalBytes;
        updateReceiveProgress('Transfer complete');
        $('receiveProgressTitle').textContent = 'Transfer complete';
        $('receiverStatus').textContent = 'Everything arrived successfully.';
        toast('Transfer received');
        break;
      default:
        break;
    }
    return;
  }

  if (!state.incoming?.currentFile) return;
  const buffer = event.data instanceof ArrayBuffer ? event.data : null;
  if (!buffer) return;
  state.incoming.currentFile.chunks.push(buffer);
  state.incoming.currentFile.received += buffer.byteLength;
  state.incoming.receivedBytes += buffer.byteLength;
  updateReceiveProgress(`Receiving ${state.incoming.currentFile.name}`);
}

async function startScanner({ title, expectedKind, onComplete }) {
  await stopScanner();
  state.scan.active = true;
  state.scan.targetKind = expectedKind;
  state.scan.onComplete = onComplete;
  state.scan.sessions = new Map();
  state.scan.lastRaw = '';
  state.scan.lastSeenAt = 0;
  $('scannerTitle').textContent = title;
  $('scanProgress').value = 0;
  $('scanProgressText').textContent = 'Waiting for a QR frame…';
  $('scanHint').textContent = 'Point the camera at the animated QR code.';
  $('pastePairingText').value = '';
  setHidden($('scannerModal'), false);

  if (!('BarcodeDetector' in window)) {
    $('scanProgressText').textContent = 'This browser does not include a QR camera detector.';
    $('scanHint').textContent = 'Use Chrome on Android, or expand the paste option below.';
    return;
  }

  try {
    state.scan.detector = new BarcodeDetector({ formats: ['qr_code'] });
    state.scan.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const video = $('cameraVideo');
    video.srcObject = state.scan.stream;
    await video.play();
    scanLoop();
  } catch (error) {
    console.error(error);
    $('scanProgressText').textContent = 'Camera could not start.';
    $('scanHint').textContent = 'Allow camera permission, use HTTPS, or paste the pairing text.';
  }
}

async function scanLoop() {
  if (!state.scan.active) return;
  const video = $('cameraVideo');
  try {
    const codes = await state.scan.detector.detect(video);
    for (const code of codes) {
      const raw = code.rawValue;
      const now = Date.now();
      if (raw === state.scan.lastRaw && now - state.scan.lastSeenAt < 140) continue;
      state.scan.lastRaw = raw;
      state.scan.lastSeenAt = now;
      const result = await ingestFrame(raw, state.scan.targetKind);
      if (!result.accepted) continue;
      $('scanProgress').value = result.percent;
      $('scanProgressText').textContent = `${result.received} of ${result.total} frames collected`;
      $('scanHint').textContent = result.complete ? 'QR data complete.' : 'Keep the camera pointed at the changing QR.';
      if (state.scan.targetKind === 'direct') {
        setHidden($('directScanProgress'), false);
        $('directProgress').value = result.percent;
        $('directProgressText').textContent = `${result.received} of ${result.total} frames`;
      }
      if (result.complete) {
        const callback = state.scan.onComplete;
        await stopScanner();
        try {
          await callback(result.text);
        } catch (error) {
          console.error(error);
          toast(error.message, 5000);
        }
        return;
      }
    }
  } catch (error) {
    if (state.scan.active) console.debug('QR scan retry', error);
  }
  if (state.scan.active) requestAnimationFrame(scanLoop);
}

async function stopScanner() {
  state.scan.active = false;
  state.scan.stream?.getTracks().forEach(track => track.stop());
  state.scan.stream = null;
  const video = $('cameraVideo');
  if (video) video.srcObject = null;
  setHidden($('scannerModal'), true);
}

$('closeScannerBtn').addEventListener('click', stopScanner);
$('scannerModal').addEventListener('click', event => {
  if (event.target === $('scannerModal')) stopScanner();
});
$('usePastedTextBtn').addEventListener('click', async () => {
  const text = $('pastePairingText').value.trim();
  if (!text) return toast('Paste the copied text first.');
  const callback = state.scan.onComplete;
  await stopScanner();
  try {
    await callback(text);
  } catch (error) {
    console.error(error);
    toast(error.message, 5000);
  }
});

async function createDirectTransfer() {
  const message = $('directMessage').value;
  const file = $('directFile').files[0];
  if (!message.trim() && !file) {
    toast('Type a message or choose one small file.');
    return;
  }
  if (file && file.size > DIRECT_FILE_LIMIT) {
    toast(`QR-only files are limited to ${formatBytes(DIRECT_FILE_LIMIT)}. Use Send mode for larger files.`, 5000);
    return;
  }

  $('createDirectBtn').disabled = true;
  $('createDirectBtn').textContent = 'Preparing QR frames…';
  try {
    const envelope = { v: 1, message };
    if (file) {
      envelope.file = {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: bytesToBase64Url(new Uint8Array(await file.arrayBuffer()))
      };
    }
    const frames = await makeFrames('direct', JSON.stringify(envelope), DIRECT_CHUNK_SIZE);
    directAnimator.start(frames);
    setHidden($('directOutput'), false);
    $('directOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${frames.length} QR frame${frames.length === 1 ? '' : 's'} ready`);
  } catch (error) {
    console.error(error);
    toast(`Could not create QR transfer: ${error.message}`, 5000);
  } finally {
    $('createDirectBtn').disabled = false;
    $('createDirectBtn').textContent = 'Create QR loop';
  }
}

async function acceptDirectTransfer(text) {
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error('The QR transfer data is not valid.'); }
  const output = $('directReceived');
  output.innerHTML = '';
  if (envelope.message) {
    const card = document.createElement('article');
    card.className = 'received-card message';
    const strong = document.createElement('strong');
    strong.textContent = 'Message received';
    const paragraph = document.createElement('p');
    paragraph.textContent = envelope.message;
    card.append(strong, paragraph);
    output.appendChild(card);
  }
  if (envelope.file?.data) {
    const bytes = base64UrlToBytes(envelope.file.data);
    const blob = new Blob([bytes], { type: envelope.file.type || 'application/octet-stream' });
    const card = document.createElement('article');
    card.className = 'received-card';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = fileTypeLabel(envelope.file);
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    const strong = document.createElement('strong');
    strong.textContent = envelope.file.name || 'download';
    const sub = document.createElement('span');
    sub.textContent = `${formatBytes(bytes.byteLength)} • ${envelope.file.type || 'Unknown type'}`;
    meta.append(strong, sub);
    const link = document.createElement('a');
    link.className = 'download-link';
    link.textContent = 'Save file';
    link.download = envelope.file.name || 'download';
    link.href = URL.createObjectURL(blob);
    card.append(icon, meta, link);
    output.appendChild(card);
  }
  $('directProgress').value = 100;
  $('directProgressText').textContent = 'Transfer complete';
  toast('QR transfer received');
}

$('createDirectBtn').addEventListener('click', createDirectTransfer);
$('scanDirectBtn').addEventListener('click', () => startScanner({
  title: 'Scan QR-only transfer',
  expectedKind: 'direct',
  onComplete: acceptDirectTransfer
}));

function initialize() {
  renderSelectedFiles();
  const secure = window.isSecureContext || location.hostname === 'localhost';
  $('secureBadge').textContent = secure ? 'Encrypted peer transfer' : 'HTTPS required for camera';
  window.addEventListener('beforeunload', () => {
    senderAnimator.stop();
    answerAnimator.stop();
    directAnimator.stop();
    closePeer();
    stopScanner();
  });
}

initialize();
