'use strict';

// QR Anything Optical Transfer core.
// Clean-room LT-style fountain implementation: no network transport is used.
// The sender emits self-contained QR symbols; the receiver reconstructs the
// payload from any sufficient set of symbols, tolerating loss and reordering.

export const OPTICAL_PREFIX = 'QRO1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cdfCache = new Map();

export function bytesToBase64Url(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value));
}

export function base64UrlToUtf8(value) {
  return decoder.decode(base64UrlToBytes(value));
}

export function makeSessionId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(session, sequence) {
  let x = (fnv1a32(session) ^ Math.imul((sequence + 1) >>> 0, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function robustSolitonCdf(k) {
  if (cdfCache.has(k)) return cdfCache.get(k);
  if (k <= 1) {
    const only = new Float64Array([0, 1]);
    cdfCache.set(k, only);
    return only;
  }

  const c = 0.1;
  const delta = 0.1;
  const rho = new Float64Array(k + 1);
  const tau = new Float64Array(k + 1);
  rho[1] = 1 / k;
  for (let d = 2; d <= k; d += 1) rho[d] = 1 / (d * (d - 1));

  const R = Math.max(1, c * Math.log(k / delta) * Math.sqrt(k));
  const pivot = Math.max(1, Math.min(k, Math.floor(k / R)));
  for (let d = 1; d < pivot; d += 1) tau[d] = R / (d * k);
  tau[pivot] = Math.max(0, R * Math.log(Math.max(R / delta, 1.000001)) / k);

  let total = 0;
  for (let d = 1; d <= k; d += 1) total += rho[d] + tau[d];

  const cdf = new Float64Array(k + 1);
  let cumulative = 0;
  for (let d = 1; d <= k; d += 1) {
    cumulative += (rho[d] + tau[d]) / total;
    cdf[d] = cumulative;
  }
  cdf[k] = 1;
  cdfCache.set(k, cdf);
  return cdf;
}

export function sampleDegree(k, seed) {
  if (k <= 1) return 1;
  const cdf = robustSolitonCdf(k);
  const random = mulberry32(seed)();
  let low = 1;
  let high = k;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (random <= cdf[mid]) high = mid;
    else low = mid + 1;
  }
  return low;
}

export function chooseIndices(k, degree, seed) {
  const d = Math.max(1, Math.min(k, degree));
  if (d === k) return Array.from({ length: k }, (_, i) => i);
  const random = mulberry32((seed ^ 0xa5a5a5a5) >>> 0);
  const selected = new Set();
  while (selected.size < d) selected.add(Math.floor(random() * k));
  return [...selected];
}

function xorInto(target, source) {
  const n = Math.min(target.length, source.length);
  for (let i = 0; i < n; i += 1) target[i] ^= source[i];
}

function isAllZero(bytes) {
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

export function splitBlocks(payload, blockSize) {
  const k = Math.max(1, Math.ceil(payload.length / blockSize));
  const blocks = new Array(k);
  for (let i = 0; i < k; i += 1) {
    const block = new Uint8Array(blockSize);
    block.set(payload.subarray(i * blockSize, Math.min(payload.length, (i + 1) * blockSize)));
    blocks[i] = block;
  }
  return blocks;
}

export class FountainEncoder {
  constructor(payload, metadata, blockSize = 480) {
    this.payload = payload;
    this.blockSize = Math.max(64, Math.floor(blockSize));
    this.blocks = splitBlocks(payload, this.blockSize);
    this.k = this.blocks.length;
    this.session = metadata.session || makeSessionId();
    this.sequence = 0;
    this.dataSequence = 0;
    this.metadataCadence = 12;
    this.metadata = {
      protocol: 1,
      session: this.session,
      name: metadata.name || 'received-file',
      type: metadata.type || 'application/octet-stream',
      originalSize: metadata.originalSize ?? payload.length,
      payloadSize: payload.length,
      compressed: Boolean(metadata.compressed),
      sha256: metadata.sha256 || '',
      blockSize: this.blockSize,
      k: this.k,
      createdAt: Date.now()
    };
    this.metadataText = `${OPTICAL_PREFIX}M|${this.session}|${utf8ToBase64Url(JSON.stringify(this.metadata))}`;
  }

  setMetadataCadence(value) {
    this.metadataCadence = Math.max(3, Math.floor(value || 12));
  }

  nextFrame() {
    this.sequence += 1;
    if (this.sequence === 1 || this.sequence % this.metadataCadence === 0) {
      return { text: this.metadataText, kind: 'metadata', sequence: this.sequence, degree: 0 };
    }

    this.dataSequence += 1;
    const seed = mixSeed(this.session, this.dataSequence);

    // Regular degree-1 symbols make recovery deterministic even on devices that
    // miss many frames. The remaining symbols use a robust-soliton LT degree.
    if (this.dataSequence % 5 === 0 || this.k === 1) {
      const index = seed % this.k;
      const data = this.blocks[index];
      return {
        text: `${OPTICAL_PREFIX}D|${this.session}|s|${index.toString(36)}|${bytesToBase64Url(data)}`,
        kind: 'systematic',
        sequence: this.sequence,
        degree: 1,
        index
      };
    }

    const degree = sampleDegree(this.k, seed);
    const indices = chooseIndices(this.k, degree, seed);
    const symbol = new Uint8Array(this.blockSize);
    for (const index of indices) xorInto(symbol, this.blocks[index]);
    return {
      text: `${OPTICAL_PREFIX}D|${this.session}|r|${seed.toString(36)}|${degree.toString(36)}|${bytesToBase64Url(symbol)}`,
      kind: 'repair',
      sequence: this.sequence,
      degree,
      seed
    };
  }
}

export function parseOpticalFrame(text) {
  if (typeof text !== 'string') return null;
  const clean = text.trim();
  if (clean.startsWith(`${OPTICAL_PREFIX}M|`)) {
    const parts = clean.split('|');
    if (parts.length !== 3) return null;
    try {
      const metadata = JSON.parse(base64UrlToUtf8(parts[2]));
      if (!metadata || metadata.session !== parts[1]) return null;
      return { kind: 'metadata', session: parts[1], metadata, raw: clean };
    } catch {
      return null;
    }
  }

  if (!clean.startsWith(`${OPTICAL_PREFIX}D|`)) return null;
  const parts = clean.split('|');
  if (parts[2] === 's' && parts.length === 5) {
    const index = parseInt(parts[3], 36);
    if (!Number.isInteger(index) || index < 0) return null;
    try {
      return { kind: 'systematic', session: parts[1], index, data: base64UrlToBytes(parts[4]), raw: clean };
    } catch {
      return null;
    }
  }
  if (parts[2] === 'r' && parts.length === 6) {
    const seed = parseInt(parts[3], 36) >>> 0;
    const degree = parseInt(parts[4], 36);
    if (!Number.isInteger(degree) || degree < 1) return null;
    try {
      return { kind: 'repair', session: parts[1], seed, degree, data: base64UrlToBytes(parts[5]), raw: clean };
    } catch {
      return null;
    }
  }
  return null;
}

export class FountainDecoder {
  constructor() {
    this.reset();
  }

  reset() {
    this.session = null;
    this.metadata = null;
    this.k = 0;
    this.blockSize = 0;
    this.solved = new Map();
    this.equations = new Map();
    this.adjacency = new Map();
    this.seen = new Set();
    this.nextEquationId = 1;
    this.framesNew = 0;
    this.framesDuplicate = 0;
    this.framesBad = 0;
    this.startedAt = 0;
    this.lastProgressAt = 0;
  }

  configure(metadata) {
    const k = Number(metadata.k);
    const blockSize = Number(metadata.blockSize);
    const payloadSize = Number(metadata.payloadSize);
    if (!metadata.session || !Number.isInteger(k) || k < 1 || k > 500000) throw new Error('Invalid fountain block count.');
    if (!Number.isInteger(blockSize) || blockSize < 32 || blockSize > 2400) throw new Error('Invalid optical block size.');
    if (!Number.isInteger(payloadSize) || payloadSize < 0 || payloadSize > k * blockSize) throw new Error('Invalid optical payload size.');

    if (this.session !== metadata.session) {
      this.reset();
      this.session = metadata.session;
      this.metadata = metadata;
      this.k = k;
      this.blockSize = blockSize;
      this.startedAt = performance.now();
      return true;
    }
    this.metadata = metadata;
    return false;
  }

  acceptText(text) {
    const frame = parseOpticalFrame(text);
    if (!frame) {
      this.framesBad += 1;
      return { accepted: false, reason: 'not-optical', ...this.stats() };
    }

    if (frame.kind === 'metadata') {
      try {
        const changed = this.configure(frame.metadata);
        return { accepted: true, metadata: true, sessionChanged: changed, ...this.stats() };
      } catch (error) {
        this.framesBad += 1;
        return { accepted: false, reason: error.message, ...this.stats() };
      }
    }

    if (!this.metadata || !this.session || frame.session !== this.session) {
      return { accepted: false, reason: 'waiting-metadata', ...this.stats() };
    }

    const key = frame.kind === 'systematic'
      ? `s:${frame.index}`
      : `r:${frame.seed}:${frame.degree}`;
    if (this.seen.has(key)) {
      this.framesDuplicate += 1;
      return { accepted: true, duplicate: true, ...this.stats() };
    }
    this.seen.add(key);

    if (frame.data.length !== this.blockSize) {
      this.framesBad += 1;
      return { accepted: false, reason: 'wrong-block-size', ...this.stats() };
    }

    if (frame.kind === 'systematic') {
      if (frame.index >= this.k) {
        this.framesBad += 1;
        return { accepted: false, reason: 'bad-index', ...this.stats() };
      }
      this.framesNew += 1;
      this._solve(frame.index, frame.data.slice());
      return { accepted: true, ...this.stats() };
    }

    if (frame.degree > this.k) {
      this.framesBad += 1;
      return { accepted: false, reason: 'bad-degree', ...this.stats() };
    }

    this.framesNew += 1;
    const indices = chooseIndices(this.k, frame.degree, frame.seed);
    this._addEquation(indices, frame.data.slice());
    return { accepted: true, ...this.stats() };
  }

  _addEquation(indicesInput, data) {
    const indices = new Set(indicesInput);
    for (const index of [...indices]) {
      const known = this.solved.get(index);
      if (known) {
        xorInto(data, known);
        indices.delete(index);
      }
    }

    if (indices.size === 0) {
      if (!isAllZero(data)) this.framesBad += 1;
      return;
    }
    if (indices.size === 1) {
      this._solve(indices.values().next().value, data);
      return;
    }

    const id = this.nextEquationId++;
    const equation = { id, indices, data };
    this.equations.set(id, equation);
    for (const index of indices) {
      let refs = this.adjacency.get(index);
      if (!refs) {
        refs = new Set();
        this.adjacency.set(index, refs);
      }
      refs.add(id);
    }
  }

  _removeEquation(equation) {
    this.equations.delete(equation.id);
    for (const index of equation.indices) {
      const refs = this.adjacency.get(index);
      if (!refs) continue;
      refs.delete(equation.id);
      if (!refs.size) this.adjacency.delete(index);
    }
  }

  _solve(firstIndex, firstData) {
    const queue = [[firstIndex, firstData]];
    while (queue.length) {
      const [index, data] = queue.shift();
      const existing = this.solved.get(index);
      if (existing) {
        let mismatch = false;
        for (let i = 0; i < existing.length; i += 1) {
          if (existing[i] !== data[i]) { mismatch = true; break; }
        }
        if (mismatch) this.framesBad += 1;
        continue;
      }

      this.solved.set(index, data.slice());
      this.lastProgressAt = performance.now();
      const refs = [...(this.adjacency.get(index) || [])];
      this.adjacency.delete(index);

      for (const equationId of refs) {
        const equation = this.equations.get(equationId);
        if (!equation || !equation.indices.has(index)) continue;
        equation.indices.delete(index);
        xorInto(equation.data, data);

        if (equation.indices.size === 0) {
          this._removeEquation(equation);
          if (!isAllZero(equation.data)) this.framesBad += 1;
        } else if (equation.indices.size === 1) {
          const nextIndex = equation.indices.values().next().value;
          const nextData = equation.data.slice();
          this._removeEquation(equation);
          queue.push([nextIndex, nextData]);
        }
      }
    }
  }

  get complete() {
    return Boolean(this.metadata && this.solved.size === this.k);
  }

  progress() {
    return this.k ? this.solved.size / this.k : 0;
  }

  stats() {
    return {
      session: this.session,
      solved: this.solved.size,
      total: this.k,
      percent: Math.floor(this.progress() * 100),
      framesNew: this.framesNew,
      framesDuplicate: this.framesDuplicate,
      framesBad: this.framesBad,
      equations: this.equations.size,
      complete: this.complete
    };
  }

  assemblePayload() {
    if (!this.complete) throw new Error('The optical transfer is not complete yet.');
    const payloadSize = Number(this.metadata.payloadSize);
    const joined = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i += 1) joined.set(this.solved.get(i), i * this.blockSize);
    return joined.slice(0, payloadSize);
  }
}
