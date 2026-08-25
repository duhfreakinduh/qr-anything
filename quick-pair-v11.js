'use strict';

(function initQuickPairV11() {
  if (window.__qrAnythingQuickPairV11) return;
  window.__qrAnythingQuickPairV11 = true;

  const $ = id => document.getElementById(id);
  const tabs = document.querySelector('.tabs');
  const hero = document.querySelector('.hero');
  if (!tabs || !hero) return;

  const style = document.createElement('style');
  style.id = 'quickPairV11Styles';
  style.textContent = `
    .quick-mode-bar{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin:0 0 1rem}.quick-mode{min-height:76px;border:1px solid var(--border);border-radius:1rem;background:rgba(255,255,255,.035);color:var(--text);padding:.8rem .7rem;display:grid;place-items:center;gap:.18rem;text-align:center;font:inherit;cursor:pointer}.quick-mode strong{font-size:1rem}.quick-mode span{color:var(--muted);font-size:.78rem;line-height:1.25}.quick-mode.active{border-color:#56a8ff;box-shadow:0 0 0 1px rgba(86,168,255,.22) inset;background:rgba(86,168,255,.12)}.quick-mode.optical{border-color:rgba(65,230,168,.35)}.quick-mode.optical strong{color:#69efbc}.quick-more-row{display:flex;justify-content:center;margin:-.25rem 0 .8rem}.quick-more{border:0;background:transparent;color:var(--muted);text-decoration:underline;font:inherit;font-size:.85rem;padding:.45rem}.tabs.quick-hidden{display:none}.quick-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem;margin:.5rem 0 1rem}.quick-step{border:1px solid var(--border);border-radius:.8rem;padding:.7rem;background:rgba(255,255,255,.025);text-align:center;color:var(--muted);font-size:.82rem;line-height:1.35}.quick-step b{display:block;color:var(--text);font-size:.88rem;margin-bottom:.16rem}.pair-state{display:inline-flex;align-items:center;gap:.4rem;border-radius:999px;padding:.38rem .65rem;font-size:.78rem;font-weight:800;margin:.5rem 0 0;background:rgba(255,255,255,.05);color:var(--muted);border:1px solid var(--border)}.pair-state.connected{color:#69efbc;border-color:rgba(65,230,168,.45);background:rgba(65,230,168,.08)}#createOfferBtn,#scanOfferBtn{font-size:1.02rem;min-height:54px}@media(max-width:620px){.quick-mode-bar{grid-template-columns:1fr 1fr}.quick-mode.optical{grid-column:1/-1;min-height:62px}.quick-steps{grid-template-columns:1fr}.quick-step{text-align:left}}
  `;
  document.head.appendChild(style);

  const heroHeading = hero.querySelector('h1');
  const heroLede = hero.querySelector('.lede');
  if (heroHeading) heroHeading.textContent = 'Pair the phones. Pick a file. Send.';
  if (heroLede) heroLede.textContent = 'Fast mode uses QR codes only to pair the phones, then sends the file over an encrypted browser connection. Optical mode sends the file itself through changing QR codes.';

  const bar = document.createElement('div');
  bar.className = 'quick-mode-bar';
  bar.innerHTML = `<button id="quickSendMode" class="quick-mode active" type="button"><strong>PAIR & SEND</strong><span>Fast phone-to-phone transfer</span></button><button id="quickReceiveMode" class="quick-mode" type="button"><strong>RECEIVE</strong><span>Scan sender and pair</span></button><button id="quickOpticalMode" class="quick-mode optical" type="button"><strong>OPTICAL / NO NETWORK</strong><span>File travels through QR light</span></button>`;
  tabs.parentNode.insertBefore(bar, tabs);

  const moreRow = document.createElement('div');
  moreRow.className = 'quick-more-row';
  moreRow.innerHTML = '<button id="quickMoreBtn" class="quick-more" type="button">More tools</button>';
  tabs.parentNode.insertBefore(moreRow, tabs);
  tabs.classList.add('quick-hidden');

  function activateQuick(name){$('quickSendMode')?.classList.toggle('active',name==='send');$('quickReceiveMode')?.classList.toggle('active',name==='receive');}
  function showPanel(name){if(typeof window.switchTab==='function')window.switchTab(name);else{document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===name));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));}activateQuick(name);document.getElementById(name)?.scrollIntoView({behavior:'smooth',block:'start'});}
  $('quickSendMode')?.addEventListener('click',()=>showPanel('send'));
  $('quickReceiveMode')?.addEventListener('click',()=>showPanel('receive'));
  $('quickOpticalMode')?.addEventListener('click',()=>{location.href='./optical/?v=11';});
  $('quickMoreBtn')?.addEventListener('click',e=>{const hidden=tabs.classList.toggle('quick-hidden');e.currentTarget.textContent=hidden?'More tools':'Hide extra tools';});

  function addSteps(panelId, stepsId, html){const panel=$(panelId);if(!panel||$(stepsId))return;const steps=document.createElement('div');steps.id=stepsId;steps.className='quick-steps';steps.innerHTML=html;panel.querySelector('.panel-heading')?.insertAdjacentElement('afterend',steps);}
  addSteps('send','quickSendSteps','<div class="quick-step"><b>1. Choose</b>Select a file, photo, video, or message.</div><div class="quick-step"><b>2. Pair</b>Receiver scans your QR, then you scan its reply.</div><div class="quick-step"><b>3. Send</b>Transfer starts automatically when paired.</div>');
  addSteps('receive','quickReceiveSteps','<div class="quick-step"><b>1. Scan sender</b>Point this phone at the sender pairing QR.</div><div class="quick-step"><b>2. Show reply</b>Your phone makes a reply QR automatically.</div><div class="quick-step"><b>3. Receive</b>The file arrives automatically after pairing.</div>');
  const oldInstructions=$('receive')?.querySelector('.instructions');if(oldInstructions)oldInstructions.style.display='none';

  if($('send-heading'))$('send-heading').textContent='Choose a file, then pair the phones';
  if($('receive-heading'))$('receive-heading').textContent='Pair this phone to receive';
  if($('createOfferBtn'))$('createOfferBtn').textContent='PAIR PHONES & SEND';
  if($('scanOfferBtn'))$('scanOfferBtn').textContent='SCAN SENDER TO PAIR';
  if($('scanAnswerBtn'))$('scanAnswerBtn').textContent='SCAN PAIRING REPLY';
  if($('copyOfferBtn'))$('copyOfferBtn').textContent='Pairing fallback: copy';
  if($('copyAnswerBtn'))$('copyAnswerBtn').textContent='Pairing fallback: copy reply';
  const senderPairTitle=$('senderPairing')?.querySelector('h3');if(senderPairTitle)senderPairTitle.textContent='Receiver: scan this pairing QR';
  const receiverPairTitle=$('receiverAnswer')?.querySelector('h3');if(receiverPairTitle)receiverPairTitle.textContent='Sender: scan this reply QR';

  const senderState=document.createElement('div');senderState.id='quickSenderState';senderState.className='pair-state';senderState.textContent='NOT PAIRED';$('senderStatus')?.insertAdjacentElement('afterend',senderState);
  const receiverState=document.createElement('div');receiverState.id='quickReceiverState';receiverState.className='pair-state';receiverState.textContent='NOT PAIRED';$('receiverStatus')?.insertAdjacentElement('afterend',receiverState);
  function updatePairState(statusEl,badge,side){if(!statusEl||!badge)return;const text=(statusEl.textContent||'').toLowerCase();const connected=/connected|starting encrypted transfer|waiting for the encrypted transfer|sent successfully|arrived successfully/.test(text);const pairing=/connecting|waiting|starting|pair/.test(text);badge.classList.toggle('connected',connected);badge.textContent=connected?(side==='send'?'PAIRED ✓ • SENDING':'PAIRED ✓ • RECEIVING'):(pairing?'PAIRING…':'NOT PAIRED');}
  const senderStatus=$('senderStatus'),receiverStatus=$('receiverStatus');const observer=new MutationObserver(()=>{updatePairState(senderStatus,$('quickSenderState'),'send');updatePairState(receiverStatus,$('quickReceiverState'),'receive');});if(senderStatus)observer.observe(senderStatus,{childList:true,subtree:true,characterData:true});if(receiverStatus)observer.observe(receiverStatus,{childList:true,subtree:true,characterData:true});updatePairState(senderStatus,$('quickSenderState'),'send');updatePairState(receiverStatus,$('quickReceiverState'),'receive');

  document.addEventListener('click',event=>{const tab=event.target.closest?.('.tab');if(!tab)return;if(tab.dataset.tab==='send'||tab.dataset.tab==='receive')activateQuick(tab.dataset.tab);else activateQuick('');});
})();
