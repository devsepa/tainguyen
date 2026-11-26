# Local Instagram registration tool

Approved in chat: Windows tool, existing resource warehouse as its control panel,
one visible browser session at a time. Inputs are email from the warehouse, name,
username, password, date of birth, and an optional authenticated proxy in
`host:port:user:pass` format. Never embed credentials supplied in chat.

## Approaches and decision

A Chrome extension would be lighter but shares proxy configuration with browser
profiles. A local Node.js + Playwright tool was selected for isolated sessions,
proxy diagnostics, and explicit progress. The existing page remains the UI.

## Architecture

A loopback HTTP server serves an allowlist of warehouse assets and an authenticated,
same-origin API. It does not expose resource files, arbitrary paths, or a public
listener. A per-process token and strict Host/Origin checks protect browser actions.
The warehouse still uses its existing membership and transaction functions to save
results; no database changes or privileged credentials are needed.

The runner validates all input, tests HTTP and SOCKS5 when auto is chosen, pins the
working proxy for the entire session, opens headed Chromium, fills available form
fields, submits once, and waits for a verification form. Authenticated SOCKS5 uses
a local proxy relay because Chromium does not natively support SOCKS5 credentials.
Proxy failure must never fall back to a direct connection.

Tempamail Access Key mailboxes reuse the existing provider protocol. Snapshot old
message IDs before registration and require a new, recent Instagram verification
message for the selected recipient. Unsupported providers use manual OTP entry.
Never treat submission of an OTP as evidence of success. Require a logged-in
Instagram identity matching the requested username before offering to save.

## Controls and lifecycle

Provide proxy test, start, stop, manual OTP, and resume after manual verification.
CAPTCHA, checkpoints, unfamiliar forms, and validation errors pause the runner for
the user; no bypass, proxy rotation, or automatic repeated account creation.
Bound OTP waiting and allow manual continuation. Failed mailbox access is visible.
Keep secrets only in process memory, exclude them from status/logs, and do not
persist proxy credentials. Save successful account credentials only through the
existing warehouse operation, with the user's existing edit permission.

## Verification and limits

Use synthetic local forms and mailbox fixtures to test the complete workflow
without creating a real account or spending the user's proxy traffic. Test proxy
auth through a local proxy fixture. Cover stale OTP, wrong recipient, cancellation,
unexpected form, failed persistence, duplicate identity, and unauthorized local
requests. Instagram's live form can change; a real successful registration is not
claimed without a live run initiated by the user.
