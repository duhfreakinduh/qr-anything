'use strict';

(function initProductHomeV12() {
  if (window.__qrAnythingProductHomeV12) return;
  window.__qrAnythingProductHomeV12 = true;

  const $ = id => document.getElementById(id);
  const main = document.querySelector('main.shell');
  const hero = document.querySelector('.hero');
  const tabs = document.querySelector('.tabs');
  if (!main || !hero || !tabs) return;

  document.body.classList.add('product-v12');

  const style = document.createElement('style');
  style.id = 'productHomeV12Styles';
  style.textContent = `
    body.product-v12{background:radial-gradient(circle at 20% 0%,rgba(43,118,177,.12),transparent 34rem),#050a12;color:#edf5ff}
    body.product-v12 .topbar{border-bottom:1px solid #172235;background:rgba(5,10,18,.88);backdrop-filter:blur(18px);position:sticky;top:0;z-index:50}
    body.product-v12 .brand strong{letter-spacing:.08em;text-transform:uppercase}
    body.product-v12 .brand small{color:#73849e}
    body.product-v12 .badge{background:#0b1523;border-color:#20324b;color:#75d4ff}
    body.product-v12 .hero{display:none!important}
    body.product-v12 .quick-mode-bar,body.product-v12 .quick-more-row{display:none!important}
    body.product-v12 .tabs{display:none!important}
    body.product-v12 .panel.v12-panel-hidden{display:none!important}
    .v12-home{padding:3rem 0 1.5rem;max-width:880px;margin:0 auto}
    .v12-kicker{margin:0 0 .8rem;color:#56c7ff;font-size:.78rem;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
    .v12-title{font-size:clamp(2.75rem,9vw,5.6rem);line-height:.94;letter-spacing:-.055em;margin:0;max-width:760px;font-weight:900}
    .v12-title span{display:block;color:#7f91ad}
    .v12-subtitle{max-width:660px;color:#91a1b9;font-size:clamp(1rem,3vw,1.18rem);line-height:1.65;margin:1.4rem 0 0}
    .v12-cards{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:2.5rem 0 1.25rem}
    .v12-action{appearance:none;border:1px solid #20324b;background:linear-gradient(160deg,#0d1726,#09111d);border-radius:1.25rem;padding:1.3rem;text-align:left;color:#eff7ff;min-height:230px;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 16px 50px rgba(0,0,0,.18);transition:transform .16s ease,border-color .16s ease,background .16s ease}
    .v12-action:hover,.v12-action:focus-visible{transform:translateY(-2px);border-color:#4bbcff;outline:none;background:linear-gradient(160deg,#102036,#09111d)}
    .v12-action small{display:block;color:#56c7ff;font-size:.75rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase;margin-bottom:.8rem}
    .v12-action strong{display:block;font-size:clamp(1.55rem,5vw,2.15rem);line-height:1.04;letter-spacing:-.025em;max-width:260px}
    .v12-arrow{width:52px;height:52px;border-radius:999px;display:grid;place-items:center;background:#58c9ff;color:#03101a;font-size:1.65rem;font-weight:900;margin-top:1.5rem}
    .v12-action.receive .v12-arrow{background:#6ff0bd}
    .v12-note{border:1px solid #17263a;background:#08111d;border-radius:1rem;padding:1rem 1.1rem;color:#8191aa;display:flex;gap:.8rem;align-items:flex-start;line-height:1.5;font-size:.9rem}
    .v12-note b{color:#dfeeff}
    .v12-note-mark{color:#56c7ff;font-size:1.25rem;line-height:1}
    .v12-proof{display:grid;grid-template-columns:repeat(3,1fr);gap:.65rem;margin:1rem 0 0}
    .v12-proof div{border:1px solid #142235;border-radius:.85rem;padding:.85rem;background:#07101a}
    .v12-proof strong{display:block;color:#eaf5ff;font-size:.9rem}.v12-proof span{display:block;color:#71829b;font-size:.78rem;margin-top:.2rem;line-height:1.35}
    .v12-sheet-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);display:grid;place-items:end center;z-index:1000;padding:1rem}
    .v12-sheet-backdrop.hidden{display:none}
    .v12-sheet{width:min(620px,100%);background:#07111e;border:1px solid #21344d;border-radius:1.35rem;padding:1.15rem;box-shadow:0 25px 90px rgba(0,0,0,.6)}
    .v12-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.8rem}
    .v12-sheet-head p{margin:.2rem 0 0;color:#8191aa;font-size:.9rem}.v12-sheet-head h2{margin:0;font-size:1.4rem}
    .v12-close{border:1px solid #223650;background:#0a1624;color:#d8e7fb;width:42px;height:42px;border-radius:.85rem;font-size:1.4rem}
    .v12-mode-option{width:100%;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.9rem;border:1px solid #1d3048;background:#0a1624;color:#edf6ff;border-radius:1rem;padding:1rem;text-align:left;margin-top:.7rem;cursor:pointer}
    .v12-mode-option:hover,.v12-mode-option:focus-visible{outline:none;border-color:#54c8ff;background:#0d1c2e}
    .v12-mode-icon{width:46px;height:46px;border-radius:.85rem;display:grid;place-items:center;background:#12263c;color:#61ceff;font-size:1.25rem;font-weight:900}
    .v12-mode-option.optical .v12-mode-icon{background:#0d2a25;color:#70efbd}
    .v12-mode-copy strong{display:block;font-size:1rem}.v12-mode-copy span{display:block;color:#7f91a9;font-size:.82rem;line-height:1.4;margin-top:.18rem}
    .v12-mode-chevron{color:#6d809b;font-size:1.35rem}
    .v12-mode-tip{margin:.8rem .2rem .1rem;color:#6f8099;font-size:.78rem;line-height:1.45}
    .v12-workbar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin:1rem 0 .9rem}
    .v12-home-button{border:1px solid #20334c;background:#091421;color:#dceafa;border-radius:.75rem;padding:.65rem .85rem;font:inherit;font-weight:800;font-size:.86rem}
    .v12-worklabel{color:#73859f;font-size:.8rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    @media(max-width:640px){.v12-home{padding-top:2.1rem}.v12-cards{grid-template-columns:1fr 1fr;gap:.7rem}.v12-action{min-height:205px;padding:1rem}.v12-action strong{font-size:1.55rem}.v12-proof{grid-template-columns:1fr}.v12-title{font-size:clamp(3.15rem,16vw,4.6rem)}}
    @media(max-width:430px){.v12-cards{grid-template-columns:1fr}.v12-action{min-height:175px}.v12-arrow{width:46px;height:46px}}
  `;
  document.head.appendChild(style);

  const home = document.createElement('section');
  home.id = 'v12Home';
  home.className = 'v12-home';
  home.innerHTML = `
    <p class="v12-kicker">QR ANYTHING • DEVICE-TO-DEVICE</p>
    <h1 class="v12-title">Transfer files <span>your way.</span></h1>
    <p class="v12-subtitle">Send a file, photo, video, audio, or text between two phones. Choose fast encrypted transfer for speed, or optical transfer when you want the bytes to travel through the screen and camera.</p>
    <div class="v12-cards">
      <button id="v12Send" class="v12-action send" type="button"><div><small>THIS PHONE SENDS</small><strong>Send a file<br>or text</strong></div><span class="v12-arrow">→</span></button>
      <button id="v12Receive" class="v12-action receive" type="button"><div><small>THIS PHONE RECEIVES</small><strong>Point and<br>receive</strong></div><span class="v12-arrow">↓</span></button>
    </div>
    <div class="v12-note"><span class="v12-note-mark">◈</span><div><b>Two transfer engines, one simple app.</b><br>Fast mode uses QR to pair and then sends over an encrypted browser connection. Optical mode carries the file itself in changing QR frames.</div></div>
    <div class="v12-proof"><div><strong>No account</strong><span>Open the page and transfer.</span></div><div><strong>No file upload</strong><span>Your app does not store the payload.</span></div><div><strong>Optical fallback</strong><span>Send screen → camera when needed.</span></div></div>
  `;
  main.insertBefore(home, main.firstChild);

  const sheet = document.createElement('div');
  sheet.id = 'v12ModeSheet';
  sheet.className = 'v12-sheet-backdrop hidden';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<div class="v12-sheet"><div class="v12-sheet-head"><div><h2 id="v12SheetTitle">Choose transfer</h2><p id="v12SheetText">How do you want to send?</p></div><button id="v12CloseSheet" class="v12-close" type="button" aria-label="Close">×</button></div><button id="v12FastMode" class="v12-mode-option" type="button"><span class="v12-mode-icon">⚡</span><span class="v12-mode-copy"><strong>Fast Internet Transfer</strong><span>QR pair, then encrypted WebRTC. Best for videos and larger files.</span></span><span class="v12-mode-chevron">›</span></button><button id="v12OpticalMode" class="v12-mode-option optical" type="button"><span class="v12-mode-icon">▦</span><span class="v12-mode-copy"><strong>Optical / No Network Path</strong><span>The actual file travels as changing QR light from screen to camera.</span></span><span class="v12-mode-chevron">›</span></button><p class="v12-mode-tip">Fast mode is usually much quicker. Optical mode is for the screen-to-camera transfer you were testing.</p></div>`;
  document.body.appendChild(sheet);

  let selectedDirection = 'send';
  const panels = [...document.querySelectorAll('main.shell > .panel')];

  function hideWorkPanels() {
    panels.forEach(panel => panel.classList.add('v12-panel-hidden'));
  }

  function openHome() {
    hideWorkPanels();
    home.hidden = false;
    sheet.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSheet(direction) {
    selectedDirection = direction;
    $('v12SheetTitle').textContent = direction === 'send' ? 'Choose how to send' : 'Choose how to receive';
    $('v12SheetText').textContent = direction === 'send' ? 'Pick the transfer path for this file.' : 'Use the same mode the sending phone chose.';
    sheet.classList.remove('hidden');
  }

  function ensureWorkbar(panel, label) {
    if (!panel || panel.querySelector('.v12-workbar')) return;
    const bar = document.createElement('div');
    bar.className = 'v12-workbar';
    bar.innerHTML = `<button class="v12-home-button" type="button">← Home</button><span class="v12-worklabel">${label}</span>`;
    bar.querySelector('button').addEventListener('click', openHome);
    panel.insertBefore(bar, panel.firstChild);
  }

  function openFast(direction) {
    home.hidden = true;
    sheet.classList.add('hidden');
    hideWorkPanels();
    const panel = $(direction === 'send' ? 'send' : 'receive');
    if (!panel) return;
    panel.classList.remove('v12-panel-hidden');
    panel.classList.add('active');
    ensureWorkbar(panel, direction === 'send' ? 'FAST SEND' : 'FAST RECEIVE');
    if (typeof window.switchTab === 'function') window.switchTab(direction === 'send' ? 'send' : 'receive');
    panel.classList.remove('v12-panel-hidden');
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }

  function openOptical(direction) {
    location.href = `./optical/?mode=${encodeURIComponent(direction)}&v=12`;
  }

  $('v12Send').addEventListener('click', () => openSheet('send'));
  $('v12Receive').addEventListener('click', () => openSheet('receive'));
  $('v12CloseSheet').addEventListener('click', () => sheet.classList.add('hidden'));
  sheet.addEventListener('click', event => { if (event.target === sheet) sheet.classList.add('hidden'); });
  $('v12FastMode').addEventListener('click', () => openFast(selectedDirection));
  $('v12OpticalMode').addEventListener('click', () => openOptical(selectedDirection));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') sheet.classList.add('hidden'); });

  const secureBadge = $('secureBadge');
  if (secureBadge) secureBadge.textContent = 'Fast + Optical';
  const brandSmall = document.querySelector('.brand small');
  if (brandSmall) brandSmall.textContent = 'Fast + optical file transfer';

  hideWorkPanels();
})();
