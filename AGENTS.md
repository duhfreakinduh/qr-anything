# AI / Contributor Guide

Keep QR Anything fast, private, and easy to pair. File transfer and QR workflows must remain useful without AI.

## Priorities
1. Prefer direct/local transfer paths and avoid uploading file contents to third parties unless the user explicitly chooses that behavior.
2. Never commit secrets, relay credentials, provider tokens, or private endpoints.
3. If AI is added, limit it to helpful tasks such as explaining errors, suggesting transfer modes, or classifying user-entered text; do not send files to AI by default.
4. Pairing codes and session identifiers must expire and should not expose reusable credentials.
5. Handle camera denial, unsupported APIs, flaky connections, and large files cleanly.
6. Preserve mobile/iOS compatibility and progressive enhancement.
7. Keep generated QR payloads explicit so users know what is encoded.
8. Update README when pairing/transport behavior changes.

## Before merging
- Test sender and receiver on separate devices when practical.
- Test camera permission denied.
- Test cancelled/failed transfer recovery.
- Verify no file contents or secrets appear in console logs.
- Test on a narrow mobile viewport.
