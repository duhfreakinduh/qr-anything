# QR Anything

QR Anything is a mobile-first static web app that transfers messages and arbitrary files directly between two browsers.

## What it sends

- Text messages
- Photos and images
- Video
- Audio
- PDFs, archives, documents, and other file types
- Multiple files in one transfer

## How it works

### Fast transfer

1. Device A selects a message and/or files.
2. Device A displays an animated QR pairing code containing a WebRTC offer.
3. Device B scans the offer and displays an animated answer QR.
4. Device A scans the answer.
5. The browsers establish an encrypted WebRTC data channel and transfer the bytes peer-to-peer.

The app does not include an upload server and does not intentionally store transferred content.

### QR-only fallback

Text or a file up to 500 KB can be encoded directly into a repeating QR loop. This is slower, but does not require a WebRTC peer connection.

## Important limitations

- Camera access requires HTTPS or localhost.
- Chrome on Android has the best built-in support for the BarcodeDetector QR scanner used by this version.
- Browsers without BarcodeDetector can use the copy/paste fallback for WebRTC pairing.
- Same-Wi-Fi peer connections are usually easiest. Some restrictive networks require a TURN relay, which this serverless version does not provide.
- Very large files are limited by browser memory, device power management, and network conditions.
- QR-only transfer is not practical for large photos or video because it would require hundreds or thousands of QR frames.

## Run locally

Because camera and service-worker features require a secure context, use localhost rather than opening `index.html` directly:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Publish with GitHub Pages

1. Put these files in the root of a GitHub repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the default branch and `/ (root)`.
5. Save and wait for the Pages URL.

## Main files

- `index.html` — interface
- `styles.css` — responsive styling
- `app.js` — QR framing, camera scan, WebRTC pairing, and transfer protocol
- `sw.js` — local asset cache
- `manifest.webmanifest` — installable PWA metadata
- `icon.svg` — app icon

## Privacy and security notes

WebRTC data channels are encrypted in transit. Pairing details are exchanged through QR codes instead of a signaling server. STUN servers may see network metadata needed for connectivity, but this application does not send file contents to them.

## License

MIT
