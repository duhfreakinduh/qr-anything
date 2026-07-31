'use strict';

const $ = id => document.getElementById(id);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FRAME_PREFIX = 'QRA1';
const PAIR_CHUNK_SIZE = 420;
const DIRECT_CHUNK_SIZE = 620;
const DIRECT_FILE_LIMIT = 500 * 1024;
const DATA_CHUNK_SIZE = 16 * 1024;
const HIGH_WATER_MARK = 4 * 1024 * 1024;

const state = {
  selectedFiles: [],
  pc: null,
  channel: null,
  role: null,
  senderPayload: null,
  senderPairingText: '',
  receiverAnswerText: '',
  transferStarted: false,
  incoming: null,
  scan: {
    active: false,
    stream: null,
    detector: null,
    targetKind: null,
    onComplete: null,
    sessions: new Map(),
    lastRaw: '',
    lastSeenAt: 0
  }
};

class QrAnimator {
  constructor(container, counter, speedControl) {
    this.container = container;
    this.counter = counter;
    this.speedControl = speedControl;
    this.frames = [];
    this.index = 0;
    this.timer = null;
    this.speedControl?.addEventListener('input', () => this.restart());
  }

  start(frames) {
    this.stop();
    this.frames = frames;
    this.index = 0;
    this.render();
    if (frames.length > 1) {
      this.timer = setInterval(() => {
        this.index = (this.index + 1) % this.frames.length;
        this.render();
      }, Number(this.speedControl?.value || 360));
    }
  }

  restart() {
    if (!this.frames.length) return;
    const frames = this.frames;
    this.start(frames);
  }

  render() {
    if (!this.frames.length) return;
    if (typeof QRCode === 'undefined') {
      this.container.innerHTML = '<p style="color:#111;text-align:center">QR library did not load. Check your connection and reload.</p>';
      return;
    }
    this.container.innerHTML = '';
    const width = Math.max(220, Math.min(360, this.container.clientWidth - 32 || 320));
    try {
      new QRCode(this.container, {
        text: this.frames[this.index],
        width,
        height: width,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.L
      });
      if (this.counter) this.counter.textContent = `Frame ${this.index + 1} / ${this.frames.length}`;
    } catch (error) {
      console.error(error);
      this.container.innerHTML = '<p style="color:#111;text-align:center">This QR frame was too large. Try again.</p>';
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const senderAnimator = new QrAnimator($('senderQr'), $('senderFrameCounter'), $('senderSpeed'));
const answerAnimator = new QrAnimator($('answerQr'), $('answerFrameCounter'), $('answerSpeed'));
const directAnimator = new QrAnimator($('directQr'), $('directFrameCounter'), $('directSpeed'));

function setHidden(element, hidden) {
  element?.classList.toggle('hidden', hidden);
}

function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  setHidden(el, false);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => setHidden(el, true), ms);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function randomId(length = 12) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function stringToBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToString(value) {
  return decoder.decode(base64UrlToBytes(value));
}

async function sha256Short(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].slice(0, 6).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function makeFrames(kind, text, chunkSize = PAIR_CHUNK_SIZE) {
  const payload = stringToBase64Url(text);
  const id = randomId();
  const checksum = await sha256Short(payload);
  const total = Math.max(1, Math.ceil(payload.length / chunkSize));
  const frames = [];
  for (let index = 0; index < total; index += 1) {
    const chunk = payload.slice(index * chunkSize, (index + 1) * chunkSize);
    frames.push(`${FRAME_PREFIX}|${id}|${kind}|${index}|${total}|${checksum}|${chunk}`);
  }
  return frames;
}

function parseFrame(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(`${FRAME_PREFIX}|`)) return null;
  const parts = raw.split('|');
  if (parts.length !== 7) return null;
  const [, id, kind, indexText, totalText, checksum, chunk] = parts;
  const index = Number(indexText);
  const total = Number(totalText);
  if (!id || !kind || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total || total < 1) return null;
  return { id, kind, index, total, checksum, chunk };
}

async function ingestFrame(raw, expectedKind, sessions = state.scan.sessions) {
  const frame = parseFrame(raw);
  if (!frame) return { accepted: false };
  if (expectedKind && frame.kind !== expectedKind) return { accepted: false, wrongKind: frame.kind };

  let session = sessions.get(frame.id);
  if (!session || session.total !== frame.total || session.checksum !== frame.checksum) {
    session = { kind: frame.kind, total: frame.total, checksum: frame.checksum, parts: new Map() };
    sessions.set(frame.id, session);
  }
  session.parts.set(frame.index, frame.chunk);
  const received = session.parts.size;
  const percent = Math.round((received / session.total) * 100);

  if (received !== session.total) {
    return { accepted: true, complete: false, received, total: session.total, percent };
  }

  let payload = '';
  for (let i = 0; i < session.total; i += 1) {
    const chunk = session.parts.get(i);
    if (chunk == null) return { accepted: true, complete: false, received, total: session.total, percent };
    payload += chunk;
  }
  const checksum = await sha256Short(payload);
  if (checksum !== session.checksum) {
    sessions.delete(frame.id);
    throw new Error('QR data failed its integrity check. Keep scanning and try again.');
  }
  sessions.delete(frame.id);
  return { accepted: true, complete: true, received, total: session.total, percent: 100, text: base64UrlToString(payload), kind: session.kind };
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('Copied to clipboard');
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tabId));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === tabId));
  document.getElementById(tabId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

function fileTypeLabel(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) return 'IMG';
  if (type.startsWith('video/')) return 'VID';
  if (type.startsWith('audio/')) return 'AUD';
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('zip') || /\.(zip|rar|7z)$/i.test(file.name)) return 'ZIP';
  return 'FILE';
}

function addFiles(fileList) {
  for (const file of fileList) {
    const duplicate = state.selectedFiles.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified);
    if (!duplicate) state.selectedFiles.push(file);
  }
  renderSelectedFiles();
}

function renderSelectedFiles() {
  const list = $('selectedList');
  list.innerHTML = '';
  state.selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'selected-item';
    item.innerHTML = `
      <span class="file-icon">${fileTypeLabel(file)}</span>
      <span class="file-meta"><strong></strong><span>${formatBytes(file.size)} • ${file.type || 'Unknown type'}</span></span>
      <button class="remove-file" type="button" aria-label="Remove file">×</button>
    `;
    item.querySelector('strong').textContent = file.name;
    item.querySelector('button').addEventListener('click', () => {
      state.selectedFiles.splice(index, 1);
      renderSelectedFiles();
    });
    list.appendChild(item);
  });
  const total = state.selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const messageBytes = encoder.encode($('messageInput').value).byteLength;
  if (!state.selectedFiles.length && !messageBytes) {
    $('sendSummary').textContent = 'Nothing selected yet';
  } else {
    const pieces = [];
    if (messageBytes) pieces.push('1 message');
    if (state.selectedFiles.length) pieces.push(`${state.selectedFiles.length} file${state.selectedFiles.length === 1 ? '' : 's'}`);
    $('sendSummary').textContent = `${pieces.join(' + ')} • ${formatBytes(total + messageBytes)}`;
  }
}

$('messageInput').addEventListener('input', renderSelectedFiles);
$('dropZone').addEventListener('click', () => $('fileInput').click());
$('dropZone').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    $('fileInput').click();
  }
});
$('fileInput').addEventListener('change', event => addFiles(event.target.files));
['dragenter', 'dragover'].forEach(type => $('dropZone').addEventListener(type, event => {
  event.preventDefault();
  $('dropZone').classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => $('dropZone').addEventListener(type, event => {
  event.preventDefault();
  $('dropZone').classList.remove('dragging');
}));
$('dropZone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
$('clearSelectionBtn').addEventListener('click', () => {
  state.selectedFiles = [];
  $('fileInput').value = '';
  $('messageInput').value = '';
  renderSelectedFiles();
});

function closePeer() {
  try { state.channel?.close(); } catch {}
  try { state.pc?.close(); } catch {}
  state.channel = null;
  state.pc = null;
  state.transferStarted = false;
}

function createPeer(role) {
  closePeer();
  state.role = role;
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 4
  });
  state.pc = pc;
  pc.onconnectionstatechange = () => {
    const status = pc.connectionState;
    if (role === 'sender') {
      $('senderStatus').textContent = status === 'connected' ? 'Connected. Starting transfer…' : `Connection: ${status}`;
    } else {
      $('receiverStatus').textContent = status === 'connected' ? 'Connected. Waiting for the transfer…' : `Connection: ${status}`;
    }
    if (status === 'failed') toast('Peer connection failed. Try again on the same Wi-Fi network.', 5000);
  };
  return pc;
}

function waitForIceGathering(pc, timeoutMs = 12000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function setupDataChannel(channel, role) {
  state.channel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 512 * 1024;
  channel.onopen = () => {
    if (role === 'sender') {
      $('senderStatus').textContent = 'Connected. Sending now…';
      if (!state.transferStarted) sendTransfer().catch(handleTransferError);
    } else {
      $('receiverStatus').textContent = 'Connected. Receiving data…';
      setHidden($('receiveProgressCard'), false);
    }
  };
  channel.onclose = () => {
    if (role === 'sender') $('senderStatus').textContent = 'Connection closed.';
    else $('receiverStatus').textContent = 'Connection closed.';
  };
  channel.onerror = error => {
    console.error('Data channel error', error);
    toast('The transfer channel reported an error.', 4000);
  };
  if (role === 'receiver') channel.onmessage = handleIncomingMessage;
}

async function createSenderOffer() {
  const message = $('messageInput').value;
  if (!message.trim() && !state.selectedFiles.length) {
    toast('Add a message or choose at least one file.');
    return;
  }

  $('createOfferBtn').disabled = true;
  $('createOfferBtn').textContent = 'Creating secure pairing…';
  try {
    state.senderPayload = { message, files: [...state.selectedFiles] };
    const pc = createPeer('sender');
    const channel = pc.createDataChannel('qr-anything', { ordered: true });
    setupDataChannel(channel, 'sender');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    state.senderPairingText = JSON.stringify(pc.localDescription);
    const frames = await makeFrames('offer', state.senderPairingText);
    senderAnimator.start(frames);
    setHidden($('senderPairing'), false);
    $('senderStatus').textContent = 'Waiting for the receiving device to scan…';
    $('senderPairing').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    toast(`Could not create pairing: ${error.message}`, 5000);
  } finally {
    $('createOfferBtn').disabled = false;
    $('createOfferBtn').textContent = 'Create sender pairing QR';
  }
}

async function acceptSenderOffer(text) {
  let offer;
  try { offer = JSON.parse(text); } catch { throw new Error('That sender pairing data is not valid.'); }
  if (!offer?.type || !offer?.sdp) throw new Error('That sender pairing data is incomplete.');

  switchTab('receive');
  const pc = createPeer('receiver');
  pc.ondatachannel = event => setupDataChannel(event.channel, 'receiver');
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);
  state.receiverAnswerText = JSON.stringify(pc.localDescription);
  const frames = await makeFrames('answer', state.receiverAnswerText);
  answerAnimator.start(frames);
  setHidden($('receiverAnswer'), false);
  $('receiverStatus').textContent = 'Waiting for the sending device to scan this answer…';
  $('receiverAnswer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function acceptReceiverAnswer(text) {
  if (!state.pc || state.role !== 'sender') throw new Error('Create a sender pairing QR first.');
  let answer;
  try { answer = JSON.parse(text); } catch { throw new Error('That receiver answer is not valid.'); }
  if (!answer?.type || !answer?.sdp) throw new Error('That receiver answer is incomplete.');
  await state.pc.setRemoteDescription(answer);
  switchTab('send');
  $('senderStatus').textContent = 'Answer accepted. Connecting…';
  $('senderPairing').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('createOfferBtn').addEventListener('click', createSenderOffer);
$('scanOfferBtn').addEventListener('click', () => startScanner({
  title: 'Scan sender QR loop',
  expectedKind: 'offer',
  onComplete: acceptSenderOffer
}));
$('scanAnswerBtn').addEventListener('click', () => startScanner({
  title: 'Scan receiver answer QR',
  expectedKind: 'answer',
  onComplete: acceptReceiverAnswer
}));
$('copyOfferBtn').addEventListener('click', () => copyText(state.senderPairingText));
$('copyAnswerBtn').addEventListener('click', () => copyText(state.receiverAnswerText));

