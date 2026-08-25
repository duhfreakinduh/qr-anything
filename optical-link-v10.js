'use strict';

(function addOpticalTransferLink() {
  if (document.getElementById('opticalTransferBtn')) return;

  const style = document.createElement('style');
  style.textContent = `
    .optical-transfer-link {
      display:inline-flex;align-items:center;justify-content:center;gap:.35rem;
      min-height:38px;padding:.5rem .75rem;border:1px solid rgba(243,223,105,.5);
      border-radius:.72rem;background:rgba(243,223,105,.08);color:#fff3a3;
      font-weight:850;text-decoration:none;white-space:nowrap;
    }
    .optical-transfer-link:hover,.optical-transfer-link:focus-visible {
      border-color:#f3df69;background:rgba(243,223,105,.16);outline:none;
    }
    @media(max-width:620px){.optical-transfer-link span{display:none}}
  `;
  document.head.appendChild(style);

  const link = document.createElement('a');
  link.id = 'opticalTransferBtn';
  link.className = 'optical-transfer-link';
  link.href = './optical/';
  link.title = 'Send files through animated QR frames with no payload network connection';
  link.innerHTML = '◫ <span>Optical / No Network</span>';

  const actions = document.querySelector('.topbar-actions');
  if (actions) {
    actions.insertBefore(link, actions.firstChild);
    return;
  }

  const topbar = document.querySelector('.topbar');
  const badge = document.getElementById('secureBadge');
  if (topbar) topbar.insertBefore(link, badge || null);
})();
