# Security Policy

## Reporting a vulnerability
Do not post secrets, relay/session credentials, private URLs, file contents, exploit details, or sensitive logs in a public issue. Use GitHub private vulnerability reporting if enabled; otherwise open only a minimal issue until a private channel is established.

## Security expectations
- Never commit provider tokens, relay credentials, or reusable pairing secrets.
- Treat transferred files, pairing codes, and session identifiers as private.
- Do not send file contents to AI or third parties by default.
- Expire pairing/session identifiers and validate untrusted QR payloads.
- Bound network/AI calls with timeouts and safe recovery.
- Keep console logs free of sensitive payloads.
