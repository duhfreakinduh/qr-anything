'use strict';

(function initQrAnythingV8() {
  if (window.__qrAnythingV8Loaded) return;
  window.__qrAnythingV8Loaded = true;

  const APP_URL = 'https://duhfreakinduh.github.io/qr-anything/';
  const byId = id => document.getElementById(id);

  const style = document.createElement('style');
  style.id = 'qrAnythingV8Styles';
  style.textContent = `
    .v8-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.85fr); gap:1rem; align-items:start; }
    .v8-card { border:1px solid var(--border); border-radius:1rem; padding:1rem; background:rgba(255,255,255,.025); }
    .v8-card h3 { margin-top:0; }
    .v8-field { display:grid; gap:.38rem; margin:.8rem 0; }
    .v8-field label { font-weight:800; font-size:.92rem; }
    .v8-field input, .v8-field select, .v8-field textarea { width:100%; border:1px solid var(--border); border-radius:.75rem; padding:.78rem .85rem; background:#050b14; color:var(--text); font:inherit; }
    .v8-field textarea { min-height:120px; resize:vertical; }
    .v8-hidden { display:none !important; }
    .v8-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.65rem; margin-top:.9rem; }
    .v8-qr { width:min(360px,100%); min-height:280px; margin:.4rem auto .8rem; display:grid; place-items:center; }
    .v8-qr > div { display:inline-block; background:#fff; padding:18px; border-radius:12px; line-height:0; }
    .v8-qr canvas, .v8-qr img { display:block !important; max-width:100%; height:auto !important; image-rendering:pixelated; }
    .v8-payload { word-break:break-word; font-size:.85rem; color:var(--muted); margin:.75rem 0 0; }
    .v8-diagnostics { margin-top:1rem; }
    .v8-checks { display:grid; gap:.55rem; margin:.8rem 0; }
    .v8-check { display:grid; grid-template-columns:auto 1fr; gap:.65rem; align-items:start; border:1px solid var(--border); border-radius:.75rem; padding:.7rem .8rem; }
    .v8-check-icon { font-weight:900; width:1.4rem; text-align:center; }
    .v8-check strong { display:block; }
    .v8-check span { display:block; color:var(--muted); font-size:.88rem; margin-top:.1rem; }
    .v8-wake { margin-top:.7rem; font-size:.82rem; color:var(--muted); text-align:center; }
    @media (max-width:800px) { .v8-grid { grid-template-columns:1fr; } }
    @media (max-width:560px) { .v8-actions { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);

  function escapeWifi(value) {
    return String(value || '').replace(/([\\;,:"])/g, '\\$1');
  }

  function normalizeUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
    return `https://${text}`;
  }

  function makeQrPayload() {
    const type = byId('v8QrType')?.value || 'text';
    if (type === 'url') return normalizeUrl(byId('v8Url')?.value);
    if (type === 'wifi') {
      const ssid = byId('v8WifiSsid')?.value || '';
      const password = byId('v8WifiPassword')?.value || '';
      const security = byId('v8WifiSecurity')?.value || 'WPA';
      const hidden = byId('v8WifiHidden')?.checked ? 'true' : 'false';
      if (!ssid.trim()) return '';
      const passPart = security === 'nopass' ? '' : `P:${escapeWifi(password)};`;
      return `WIFI:T:${security};S:${escapeWifi(ssid)};${passPart}H:${hidden};;`;
    }
    if (type === 'contact') {
      const name = (byId('v8ContactName')?.value || '').trim();
      const phone = (byId('v8ContactPhone')?.value || '').trim();
      const email = (byId('v8ContactEmail')?.value || '').trim();
      if (!name && !phone && !email) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
      if (name) lines.push(`FN:${name.replace(/[\r\n]/g, ' ')}`);
      if (phone) lines.push(`TEL:${phone.replace(/[\r\n]/g, '')}`);
      if (email) lines.push(`EMAIL:${email.replace(/[\r\n]/g, '')}`);
      lines.push('END:VCARD');
      return lines.join('\n');
    }
    return byId('v8Text')?.value || '';
  }

  function setMakerFields() {
    const type = byId('v8QrType')?.value || 'text';
    document.querySelectorAll('[data-v8-kind]').forEach(el => el.classList.toggle('v8-hidden', el.dataset.v8Kind !== type));
  }

  function renderMakerQr() {
    const payload = makeQrPayload();
    const box = byId('v8MakerQr');
    const preview = byId('v8PayloadPreview');
    if (!box || !preview) return;
    box.innerHTML = '';
    preview.textContent = payload || 'Nothing encoded yet.';
    if (!payload) {
      box.innerHTML = '<p class="muted">Enter something, then tap Create QR.</p>';
      return;
    }
    if (payload.length > 1800) {
      box.innerHTML = '<p class="muted">That is too much data for a reliable single QR. Shorten it or use QR-only transfer instead.</p>';
      return;
    }
    if (typeof QRCode === 'undefined') {
      box.innerHTML = '<p class="muted">QR renderer is unavailable. Reload while online.</p>';
      return;
    }
    const holder = document.createElement('div');
    box.appendChild(holder);
    const size = Math.max(230, Math.min(320, (box.clientWidth || 320) - 12));
    try {
      new QRCode(holder, { text: payload, width: size, height: size, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      holder.querySelectorAll('canvas,img').forEach(el => { el.style.imageRendering = 'pixelated'; el.style.maxWidth = '100%'; });
      if (typeof toast === 'function') toast('QR created');
    } catch (error) {
      console.error(error);
      box.innerHTML = '<p class="muted">Could not draw that QR. Try shorter content.</p>';
    }
  }

  async function copyMakerPayload() {
    const payload = makeQrPayload();
    if (!payload) return typeof toast === 'function' && toast('Create a QR first.');
    if (typeof copyText === 'function') return copyText(payload);
    try { await navigator.clipboard.writeText(payload); } catch {}
  }

  function saveMakerQr() {
    const box = byId('v8MakerQr');
    const canvas = box?.querySelector('canvas');
    const image = box?.querySelector('img');
    const saveHref = href => {
      const a = document.createElement('a');
      a.href = href;
      a.download = 'qr-anything-code.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (typeof toast === 'function') toast('QR image saved');
    };
    if (canvas?.toBlob) {
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        saveHref(url);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }, 'image/png');
      return;
    }
    if (image?.src) saveHref(image.src);
    else if (typeof toast === 'function') toast('Create a QR first.');
  }

  async function shareMakerQr() {
    const payload = makeQrPayload();
    if (!payload) return typeof toast === 'function' && toast('Create a QR first.');
    if (!navigator.share) return copyMakerPayload();
    const isUrl = /^https?:\/\//i.test(payload);
    try {
      await navigator.share(isUrl ? { title: 'QR Anything', text: 'Open this link', url: payload } : { title: 'QR Anything', text: payload });
    } catch (error) {
      if (error?.name !== 'AbortError') await copyMakerPayload();
    }
  }

  function addMakerPanel() {
    const tabs = document.querySelector('.tabs');
    const helpTab = tabs?.querySelector('[data-tab="help"]');
    const helpPanel = byId('help');
    if (!tabs || !helpPanel || byId('make-qr')) return;

    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.type = 'button';
    tab.dataset.tab = 'make-qr';
    tab.textContent = 'Make QR';
    tabs.insertBefore(tab, helpTab || null);

    const panel = document.createElement('section');
    panel.id = 'make-qr';
    panel.className = 'panel';
    panel.setAttribute('aria-labelledby', 'v8-maker-heading');
    panel.innerHTML = `
      <div class="panel-heading"><div><p class="step">QUICK QR MAKER</p><h2 id="v8-maker-heading">Turn almost anything into a normal QR code</h2></div><span class="pill">Text • Link • Wi-Fi • Contact</span></div>
      <div class="v8-grid">
        <div class="v8-card">
          <div class="v8-field"><label for="v8QrType">QR type</label><select id="v8QrType"><option value="text">Text</option><option value="url">Website / link</option><option value="wifi">Wi-Fi login</option><option value="contact">Contact card</option></select></div>
          <div data-v8-kind="text" class="v8-field"><label for="v8Text">Text</label><textarea id="v8Text" placeholder="Type anything you want someone to scan…"></textarea></div>
          <div data-v8-kind="url" class="v8-field v8-hidden"><label for="v8Url">Website</label><input id="v8Url" inputmode="url" placeholder="example.com or https://…" /></div>
          <div data-v8-kind="wifi" class="v8-hidden"><div class="v8-field"><label for="v8WifiSsid">Wi-Fi name (SSID)</label><input id="v8WifiSsid" autocomplete="off" /></div><div class="v8-field"><label for="v8WifiPassword">Password</label><input id="v8WifiPassword" type="text" autocomplete="off" /></div><div class="v8-field"><label for="v8WifiSecurity">Security</label><select id="v8WifiSecurity"><option value="WPA">WPA/WPA2/WPA3</option><option value="WEP">WEP</option><option value="nopass">No password</option></select></div><label><input id="v8WifiHidden" type="checkbox" /> Hidden network</label></div>
          <div data-v8-kind="contact" class="v8-hidden"><div class="v8-field"><label for="v8ContactName">Name</label><input id="v8ContactName" autocomplete="name" /></div><div class="v8-field"><label for="v8ContactPhone">Phone</label><input id="v8ContactPhone" inputmode="tel" autocomplete="tel" /></div><div class="v8-field"><label for="v8ContactEmail">Email</label><input id="v8ContactEmail" inputmode="email" autocomplete="email" /></div></div>
          <button id="v8CreateQrBtn" class="primary full" type="button">Create QR</button>
          <div class="v8-actions"><button id="v8CopyQrBtn" class="secondary" type="button">Copy data</button><button id="v8SaveQrBtn" class="secondary" type="button">Save QR</button><button id="v8ShareQrBtn" class="secondary" type="button">Share</button></div>
        </div>
        <div class="v8-card"><div id="v8MakerQr" class="v8-qr"><p class="muted">Your QR code will appear here.</p></div><p class="v8-payload"><strong>Encoded data:</strong> <span id="v8PayloadPreview">Nothing encoded yet.</span></p></div>
      </div>
      <div class="v8-card v8-diagnostics">
        <div class="panel-heading"><div><p class="step">PHONE CHECK</p><h3>Browser & connection diagnostics</h3></div><span class="pill">No permissions changed</span></div>
        <p class="muted">Checks the features QR Anything depends on and tests whether this browser can gather WebRTC network candidates, including TURN relay candidates.</p>
        <div id="v8Checks" class="v8-checks"></div>
        <div class="v8-actions"><button id="v8RunChecksBtn" class="primary" type="button">Run diagnostics</button><button id="v8CopyChecksBtn" class="secondary" type="button">Copy report</button><button id="v8OpenAppBtn" class="secondary" type="button">Open live app</button></div>
        <div id="v8WakeStatus" class="v8-wake"></div>
      </div>`;
    helpPanel.parentNode.insertBefore(panel, helpPanel);

    tab.addEventListener('click', () => {
      if (typeof switchTab === 'function') switchTab('make-qr');
      else {
        document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn === tab));
        document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p === panel));
      }
    });
    byId('v8QrType')?.addEventListener('change', setMakerFields);
    byId('v8CreateQrBtn')?.addEventListener('click', renderMakerQr);
    byId('v8CopyQrBtn')?.addEventListener('click', copyMakerPayload);
    byId('v8SaveQrBtn')?.addEventListener('click', saveMakerQr);
    byId('v8ShareQrBtn')?.addEventListener('click', shareMakerQr);
    byId('v8OpenAppBtn')?.addEventListener('click', () => window.open(APP_URL, '_blank', 'noopener'));
    setMakerFields();
  }

  let diagnosticsReport = '';

  async function gatherIceDiagnostics() {
    if (typeof RTCPeerConnection === 'undefined') return { level: 'fail', title: 'WebRTC network test', detail: 'RTCPeerConnection is not available.' };
    let servers = [{ urls: 'stun:stun.l.google.com:19302' }];
    try { if (typeof INTERNET_ICE_SERVERS !== 'undefined' && Array.isArray(INTERNET_ICE_SERVERS)) servers = INTERNET_ICE_SERVERS; } catch {}
    const types = new Set();
    const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'all' });
    try {
      pc.createDataChannel('diagnostic');
      pc.onicecandidate = event => {
        const candidate = event.candidate?.candidate || '';
        const match = candidate.match(/\btyp\s+(host|srflx|prflx|relay)\b/i);
        if (match) types.add(match[1].toLowerCase());
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const timer = setTimeout(finish, 8000);
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') { clearTimeout(timer); finish(); }
        });
      });
    } catch (error) {
      return { level: 'fail', title: 'WebRTC network test', detail: error.message || 'ICE gathering failed.' };
    } finally { pc.close(); }
    const list = [...types];
    if (types.has('relay')) return { level: 'pass', title: 'TURN relay candidate', detail: `Relay is reachable. Candidate types: ${list.join(', ')}.` };
    if (types.has('srflx')) return { level: 'warn', title: 'TURN relay candidate', detail: `Direct internet candidate found, but no relay candidate appeared. Types: ${list.join(', ')}.` };
    return { level: 'warn', title: 'WebRTC network test', detail: list.length ? `Only ${list.join(', ')} candidates appeared.` : 'No ICE candidates appeared during the test.' };
  }

  function basicDiagnostics() {
    return [
      { level: window.isSecureContext ? 'pass' : 'fail', title: 'HTTPS secure context', detail: window.isSecureContext ? 'Camera and secure browser APIs are allowed.' : 'Open the HTTPS GitHub Pages site.' },
      { level: navigator.mediaDevices?.getUserMedia ? 'pass' : 'fail', title: 'Camera API', detail: navigator.mediaDevices?.getUserMedia ? 'Camera access is supported.' : 'This browser cannot expose the camera to the app.' },
      { level: typeof RTCPeerConnection !== 'undefined' ? 'pass' : 'fail', title: 'WebRTC', detail: typeof RTCPeerConnection !== 'undefined' ? 'Peer-to-peer data channels are supported.' : 'File transfer cannot connect in this browser.' },
      { level: typeof QRCode !== 'undefined' ? 'pass' : 'fail', title: 'QR renderer', detail: typeof QRCode !== 'undefined' ? 'QR codes can be generated.' : 'The QR rendering library did not load.' },
      { level: ('BarcodeDetector' in window || !!window.ZXingBrowser) ? 'pass' : 'warn', title: 'QR scanner engine', detail: 'BarcodeDetector' in window ? 'Native QR detection is available.' : (window.ZXingBrowser ? 'ZXing fallback is loaded.' : 'ZXing will be downloaded when scanning starts.') },
      { level: 'serviceWorker' in navigator ? 'pass' : 'warn', title: 'Offline/PWA support', detail: 'serviceWorker' in navigator ? 'Service workers are supported.' : 'Offline install/cache support is unavailable.' },
      { level: navigator.share ? 'pass' : 'warn', title: 'Phone share sheet', detail: navigator.share ? 'Native sharing is available.' : 'Copy buttons will be used instead.' },
      { level: navigator.clipboard?.writeText ? 'pass' : 'warn', title: 'Clipboard', detail: navigator.clipboard?.writeText ? 'Modern clipboard writing is available.' : 'The app will use its fallback copy method.' },
      { level: 'wakeLock' in navigator ? 'pass' : 'warn', title: 'Screen wake lock', detail: 'wakeLock' in navigator ? 'The app can keep the display awake during pairing/transfers.' : 'Keep the screen awake manually during transfers.' }
    ];
  }

  function renderDiagnostics(items) {
    const box = byId('v8Checks');
    if (!box) return;
    const icon = { pass: '✓', warn: '!', fail: '×' };
    box.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'v8-check';
      row.innerHTML = `<div class="v8-check-icon">${icon[item.level] || '?'}</div><div><strong></strong><span></span></div>`;
      row.querySelector('strong').textContent = item.title;
      row.querySelector('span').textContent = item.detail;
      box.appendChild(row);
    });
    diagnosticsReport = ['QR Anything diagnostics', new Date().toISOString(), navigator.userAgent, ...items.map(item => `[${item.level.toUpperCase()}] ${item.title}: ${item.detail}`)].join('\n');
  }

  async function runDiagnostics() {
    const button = byId('v8RunChecksBtn');
    if (button) { button.disabled = true; button.textContent = 'Testing connection…'; }
    const items = basicDiagnostics();
    renderDiagnostics(items);
    items.push(await gatherIceDiagnostics());
    renderDiagnostics(items);
    if (button) { button.disabled = false; button.textContent = 'Run diagnostics'; }
    if (typeof toast === 'function') toast('Diagnostics complete');
  }

  async function copyDiagnostics() {
    if (!diagnosticsReport) await runDiagnostics();
    if (typeof copyText === 'function') return copyText(diagnosticsReport);
    try { await navigator.clipboard.writeText(diagnosticsReport); } catch {}
  }

  let wakeSentinel = null;
  let wakeWanted = false;

  async function requestWakeLock() {
    wakeWanted = true;
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeSentinel) return;
    try {
      wakeSentinel = await navigator.wakeLock.request('screen');
      wakeSentinel.addEventListener('release', () => { wakeSentinel = null; updateWakeStatus(); });
    } catch (error) { console.debug('Wake lock unavailable', error); }
    updateWakeStatus();
  }

  async function releaseWakeLock() {
    wakeWanted = false;
    try { await wakeSentinel?.release(); } catch {}
    wakeSentinel = null;
    updateWakeStatus();
  }

  function updateWakeStatus() {
    const el = byId('v8WakeStatus');
    if (!el) return;
    if (!('wakeLock' in navigator)) el.textContent = 'Screen wake lock is not supported on this browser.';
    else if (wakeSentinel) el.textContent = 'Screen stay-awake is active during pairing/transfer.';
    else el.textContent = 'Screen stay-awake activates automatically when pairing or scanning starts.';
  }

  function bindWakeLock() {
    ['createOfferBtn', 'scanOfferBtn', 'scanAnswerBtn', 'scanDirectBtn', 'createDirectBtn'].forEach(id => byId(id)?.addEventListener('click', requestWakeLock, { passive: true }));
    byId('closeScannerBtn')?.addEventListener('click', () => { if (!state.channel || state.channel.readyState !== 'open') releaseWakeLock(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeWanted) requestWakeLock(); });
    const terminalPattern = /(delivery confirmed|connection closed|connection failed|transfer stopped|receive failed)/i;
    const observer = new MutationObserver(() => {
      const text = [byId('senderStatus')?.textContent, byId('receiverStatus')?.textContent, byId('sendProgressTitle')?.textContent, byId('receiveProgressTitle')?.textContent].filter(Boolean).join(' ');
      if (terminalPattern.test(text)) releaseWakeLock();
    });
    ['senderStatus', 'receiverStatus', 'sendProgressTitle', 'receiveProgressTitle'].forEach(id => { const el = byId(id); if (el) observer.observe(el, { childList: true, subtree: true, characterData: true }); });
  }

  addMakerPanel();
  byId('v8RunChecksBtn')?.addEventListener('click', runDiagnostics);
  byId('v8CopyChecksBtn')?.addEventListener('click', copyDiagnostics);
  bindWakeLock();
  updateWakeStatus();
})();
