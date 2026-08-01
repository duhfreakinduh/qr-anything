'use strict';

// Delivery reliability layer loaded after the main app and compatibility fixes.
// It serializes incoming data, accepts Blob/typed-array chunks, waits for the
// data channel to drain, and requires a receiver acknowledgement before the
// sender reports success.

const DELIVERY_ACK_TIMEOUT_MS = 45000;
const CONNECTION_TIMEOUT_MS = 35000;
const DELIVERY_DRAIN_TIMEOUT_MS = 45000;
const originalHandleIncomingMessage = handleIncomingMessage;

state.receiveQueue = Promise.resolve();
state.pendingDeliveryAck = null;
state.connectionTimer = null;
state.receiveFailed = false;

function clearDeliveryAck(error) {
  const pending = state.pendingDeliveryAck;
  if (!pending) return;
  clearTimeout(pending.timer);
  state.pendingDeliveryAck = null;
  if (error) pending.reject(error);
}

function waitForDeliveryAck(transferId) {
  clearDeliveryAck(new Error('A newer transfer replaced the previous confirmation wait.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (state.pendingDeliveryAck?.transferId !== transferId) return;
      state.pendingDeliveryAck = null;
      reject(new Error('The receiver did not confirm delivery. Keep both devices open and try again.'));
    }, DELIVERY_ACK_TIMEOUT_MS);
    state.pendingDeliveryAck = { transferId, resolve, reject, timer };
  });
}

function resolveDeliveryAck(payload) {
  const pending = state.pendingDeliveryAck;
  if (!pending || payload.transferId !== pending.transferId) return false;
  clearTimeout(pending.timer);
  state.pendingDeliveryAck = null;
  pending.resolve(payload);
  return true;
}

function waitForChannelDrain(channel, timeoutMs = DELIVERY_DRAIN_TIMEOUT_MS) {
  if (!channel || channel.readyState !== 'open') {
    return Promise.reject(new Error('The transfer connection closed before delivery finished.'));
  }
  if (channel.bufferedAmount === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (channel.readyState !== 'open') {
        reject(new Error('The transfer connection closed before all data was delivered.'));
        return;
      }
      if (channel.bufferedAmount === 0) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('The browser could not finish sending the queued data. Try a smaller file or keep both screens awake.'));
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

function normalizeBinaryData(data) {
  if (data instanceof ArrayBuffer) return Promise.resolve(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.arrayBuffer();
  if (ArrayBuffer.isView(data)) {
    return Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return Promise.resolve(null);
}

async function processReceiverEvent(event) {
  if (typeof event.data === 'string') {
    let payload = null;
    try { payload = JSON.parse(event.data); } catch {}

    if (payload?.t === 'manifest') state.receiveFailed = false;
    if (state.receiveFailed) return;

    if (payload?.t === 'file-end') {
      const file = state.incoming?.currentFile;
      if (!file || file.id !== payload.id) throw new Error('The file ending information did not match the active file.');
      if (file.received !== file.size) {
        throw new Error(`${file.name} was incomplete: received ${formatBytes(file.received)} of ${formatBytes(file.size)}.`);
      }
    }

    originalHandleIncomingMessage(event);

    if (payload?.t === 'manifest' && state.incoming) {
      state.incoming.transferId = payload.transferId || '';
      state.incoming.expectedFiles = Array.isArray(payload.files) ? payload.files.length : 0;
    }

    if (payload?.t === 'done') {
      const incoming = state.incoming;
      if (!incoming) throw new Error('The transfer ended before its manifest arrived.');
      if (incoming.currentFile) throw new Error(`The file ${incoming.currentFile.name} did not finish downloading.`);
      if ((incoming.completedFiles || 0) !== (incoming.expectedFiles || 0)) {
        throw new Error(`Expected ${incoming.expectedFiles || 0} files but completed ${incoming.completedFiles || 0}.`);
      }

      const acknowledgement = {
        t: 'ack',
        transferId: payload.transferId || incoming.transferId || '',
        receivedBytes: incoming.receivedBytes || 0,
        completedFiles: incoming.completedFiles || 0
      };
      if (state.channel?.readyState === 'open') state.channel.send(JSON.stringify(acknowledgement));
      $('receiverStatus').textContent = 'Delivery confirmed to the sender.';
    }
    return;
  }

  if (state.receiveFailed) return;
  const buffer = await normalizeBinaryData(event.data);
  if (!buffer) throw new Error('This browser returned an unsupported file-data format.');
  originalHandleIncomingMessage({ data: buffer });
}

function handleSenderControlMessage(event) {
  if (typeof event.data !== 'string') return;
  let payload;
  try { payload = JSON.parse(event.data); } catch { return; }

  if (payload.t === 'ack') {
    resolveDeliveryAck(payload);
    return;
  }

  if (payload.t === 'transfer-error') {
    clearDeliveryAck(new Error(payload.message || 'The receiving device reported a transfer error.'));
  }
}

setupDataChannel = function setupReliableDataChannel(channel, role) {
  state.channel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 256 * 1024;

  channel.onopen = () => {
    clearTimeout(state.connectionTimer);
    if (role === 'sender') {
      $('senderStatus').textContent = 'Connected. Sending now…';
      if (!state.transferStarted) sendTransfer().catch(handleTransferError);
    } else {
      $('receiverStatus').textContent = 'Connected. Receiving data…';
      setHidden($('receiveProgressCard'), false);
    }
  };

  channel.onclose = () => {
    clearTimeout(state.connectionTimer);
    if (role === 'sender') {
      $('senderStatus').textContent = 'Connection closed.';
      clearDeliveryAck(new Error('The connection closed before the receiver confirmed delivery.'));
    } else {
      $('receiverStatus').textContent = 'Connection closed.';
    }
  };

  channel.onerror = error => {
    console.error('Data channel error', error);
    clearDeliveryAck(new Error('The transfer channel reported an error.'));
    toast('The transfer channel reported an error.', 5000);
  };

  if (role === 'receiver') {
    state.receiveQueue = Promise.resolve();
    state.receiveFailed = false;
    channel.onmessage = event => {
      state.receiveQueue = state.receiveQueue
        .then(() => processReceiverEvent(event))
        .catch(error => {
          console.error(error);
          state.receiveFailed = true;
          $('receiveProgressTitle').textContent = 'Transfer stopped';
          $('receiveProgressDetail').textContent = error.message;
          if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ t: 'transfer-error', message: error.message }));
          }
          toast(`Receive failed: ${error.message}`, 6000);
        });
    };
  } else {
    channel.onmessage = handleSenderControlMessage;
  }
};

sendTransfer = async function sendReliableTransfer() {
  state.transferStarted = true;
  const payload = state.senderPayload;
  if (!payload) throw new Error('Nothing is prepared to send.');
  if (!state.channel || state.channel.readyState !== 'open') throw new Error('The transfer connection is not open.');

  const transferId = randomId();
  const messageBytes = encoder.encode(payload.message || '').byteLength;
  const fileBytes = payload.files.reduce((sum, file) => sum + file.size, 0);
  const totalBytes = messageBytes + fileBytes;
  const fileRecords = payload.files.map((file, index) => ({
    id: `${index}-${randomId(8)}`,
    file
  }));
  let sentBytes = 0;

  setHidden($('sendProgressCard'), false);
  $('sendProgressTitle').textContent = 'Sending securely…';
  updateSendProgress(0, totalBytes, 'Starting');

  sendJson({
    t: 'manifest',
    v: 2,
    transferId,
    totalBytes,
    messageBytes,
    files: fileRecords.map(({ id, file }) => ({
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    }))
  });

  if (payload.message) {
    sendJson({ t: 'message', text: payload.message });
    sentBytes += messageBytes;
    updateSendProgress(sentBytes, totalBytes, 'Message sent');
  }

  for (const { id, file } of fileRecords) {
    sendJson({
      t: 'file-start',
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    });

    for (let offset = 0; offset < file.size; offset += DATA_CHUNK_SIZE) {
      if (state.channel.readyState !== 'open') throw new Error('The connection closed while sending a file.');
      const buffer = await file.slice(offset, offset + DATA_CHUNK_SIZE).arrayBuffer();
      await waitForBuffer(state.channel);
      state.channel.send(buffer);
      sentBytes += buffer.byteLength;
      updateSendProgress(sentBytes, totalBytes, `Sending ${file.name}`);
    }
    sendJson({ t: 'file-end', id });
  }

  await waitForChannelDrain(state.channel);
  const acknowledgement = waitForDeliveryAck(transferId);
  sendJson({ t: 'done', transferId, totalBytes, fileCount: fileRecords.length });
  await waitForChannelDrain(state.channel);

  $('sendProgressTitle').textContent = 'Waiting for receiver…';
  updateSendProgress(totalBytes, totalBytes, 'Waiting for delivery confirmation');
  const confirmed = await acknowledgement;

  if (Number.isFinite(confirmed.receivedBytes) && confirmed.receivedBytes < totalBytes) {
    throw new Error(`The receiver confirmed only ${formatBytes(confirmed.receivedBytes)} of ${formatBytes(totalBytes)}.`);
  }

  updateSendProgress(totalBytes, totalBytes, 'Receiver confirmed delivery');
  $('sendProgressTitle').textContent = 'Delivery confirmed';
  $('senderStatus').textContent = 'The receiving device confirmed everything arrived.';
  toast('Delivery confirmed');
};

const previousAcceptReceiverAnswer = acceptReceiverAnswer;
acceptReceiverAnswer = async function acceptReceiverAnswerWithTimeout(text) {
  await previousAcceptReceiverAnswer(text);
  clearTimeout(state.connectionTimer);
  state.connectionTimer = setTimeout(() => {
    if (state.channel?.readyState === 'open' || state.pc?.connectionState === 'connected') return;
    $('senderStatus').textContent = 'Could not connect. Put both devices on the same Wi-Fi and recreate the pairing codes.';
    toast('Connection timed out. Use the same Wi-Fi or QR-only mode for text and small files.', 7000);
  }, CONNECTION_TIMEOUT_MS);
};

const previousAcceptSenderOffer = acceptSenderOffer;
acceptSenderOffer = async function acceptSenderOfferWithTimeout(text) {
  await previousAcceptSenderOffer(text);
  clearTimeout(state.connectionTimer);
  state.connectionTimer = setTimeout(() => {
    if (state.channel?.readyState === 'open' || state.pc?.connectionState === 'connected') return;
    $('receiverStatus').textContent = 'Still not connected. Put both devices on the same Wi-Fi and recreate both QR codes.';
  }, CONNECTION_TIMEOUT_MS);
};

waitForIceGathering = function waitForCompleteIceGathering(pc, timeoutMs = 20000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready
    .then(registration => registration.update())
    .catch(() => {});
}
