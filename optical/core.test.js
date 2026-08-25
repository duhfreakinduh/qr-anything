import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  FountainEncoder,
  FountainDecoder,
  mulberry32,
  sha256Hex
} from './core.js';

test('reconstructs exact bytes with deterministic 30 percent frame loss', async () => {
  const payload = new Uint8Array(randomBytes(32 * 1024 + 73));
  const hash = await sha256Hex(payload);
  const encoder = new FountainEncoder(payload, {
    session: 'loss-test-001',
    name: 'clip.mp4',
    type: 'video/mp4',
    originalSize: payload.length,
    payloadSize: payload.length,
    sha256: hash
  }, 480);
  encoder.setMetadataCadence(12);

  const decoder = new FountainDecoder();
  const lossRandom = mulberry32(0xdec1a1);
  let sent = 0;

  while (!decoder.complete && sent < 8000) {
    const frame = encoder.nextFrame();
    sent += 1;
    if (lossRandom() < 0.30) continue;
    decoder.acceptText(frame.text);
  }

  assert.equal(decoder.complete, true, `decoder did not finish after ${sent} frames`);
  const reconstructed = decoder.assemblePayload();
  assert.deepEqual(reconstructed, payload);
  assert.equal(await sha256Hex(reconstructed), hash);
});

test('tolerates out-of-order, duplicate, and dropped frames', () => {
  const payload = new TextEncoder().encode('QR Anything optical fountain test '.repeat(250));
  const encoder = new FountainEncoder(payload, {
    session: 'shuffle-test-001',
    name: 'message.txt',
    type: 'text/plain',
    originalSize: payload.length,
    payloadSize: payload.length
  }, 240);
  encoder.setMetadataCadence(9);

  const frames = [];
  for (let i = 0; i < 1400; i += 1) frames.push(encoder.nextFrame().text);

  const random = mulberry32(0x1234abcd);
  for (let i = frames.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [frames[i], frames[j]] = [frames[j], frames[i]];
  }

  const decoder = new FountainDecoder();
  for (const frame of frames) {
    if (random() < 0.22) continue;
    decoder.acceptText(frame);
    if (random() < 0.08) decoder.acceptText(frame);
    if (decoder.complete) break;
  }

  assert.equal(decoder.complete, true);
  assert.deepEqual(decoder.assemblePayload(), payload);
  assert.ok(decoder.framesDuplicate >= 0);
});
