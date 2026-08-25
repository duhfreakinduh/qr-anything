'use strict';

// QRCode.js creates both a canvas and an image element. The v5 readability
// stylesheet accidentally forced both to display, which made iPhone Safari
// show two QR codes stacked together. Keep exactly one renderer visible.

(function fixDuplicateQrRenderer() {
  const previousRender = QrAnimator.prototype.render;

  function keepOneQrVisible(container) {
    if (!container) return;
    const holder = container.querySelector('.v5-qr-holder') || container;
    const canvas = holder.querySelector('canvas');
    const images = [...holder.querySelectorAll('img')];

    if (canvas) {
      canvas.style.setProperty('display', 'block', 'important');
      canvas.style.setProperty('margin', '0', 'important');
      images.forEach(image => image.style.setProperty('display', 'none', 'important'));
      return;
    }

    images.forEach((image, index) => {
      image.style.setProperty('display', index === 0 ? 'block' : 'none', 'important');
      if (index === 0) image.style.setProperty('margin', '0', 'important');
    });
  }

  QrAnimator.prototype.render = function renderSingleQr() {
    previousRender.call(this);
    keepOneQrVisible(this.container);
  };

  const style = document.createElement('style');
  style.id = 'singleQrRendererStyles';
  style.textContent = `
    .v5-qr-holder { overflow: hidden; }
    .v5-qr-holder canvas { display: block !important; margin: 0 !important; }
    .v5-qr-holder img { display: none !important; }
  `;
  document.head.appendChild(style);

  for (const id of ['senderQr', 'answerQr', 'directQr']) {
    keepOneQrVisible(document.getElementById(id));
  }
})();

// Load the v9 scanner reliability layer first, then the v8 feature upgrade,
// then expose the separate optical no-network transport.
(function loadLatestUpgrades() {
  function loadOpticalLink() {
    if (document.querySelector('script[data-qr-anything-optical]')) return;
    const script = document.createElement('script');
    script.src = './optical-link-v10.js?v=10';
    script.async = false;
    script.dataset.qrAnythingOptical = '1';
    document.head.appendChild(script);
  }

  function loadV8() {
    if (document.querySelector('script[data-qr-anything-v8]')) {
      loadOpticalLink();
      return;
    }
    const script = document.createElement('script');
    script.src = './upgrade-v8.js?v=10';
    script.async = false;
    script.dataset.qrAnythingV8 = '1';
    script.onload = loadOpticalLink;
    script.onerror = loadOpticalLink;
    document.head.appendChild(script);
  }

  if (document.querySelector('script[data-qr-anything-v9]')) {
    loadV8();
    return;
  }

  const scannerFix = document.createElement('script');
  scannerFix.src = './scan-fix-v9.js?v=10';
  scannerFix.async = false;
  scannerFix.dataset.qrAnythingV9 = '1';
  scannerFix.onload = loadV8;
  scannerFix.onerror = loadV8;
  document.head.appendChild(scannerFix);
})();
