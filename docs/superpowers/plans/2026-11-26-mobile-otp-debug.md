# Mobile OTP debugging record

## Report and evidence

The user reports that mobile Instagram registration rejects the OTP while desktop
works; entering the code directly in the mobile page also fails. The screenshot
shows the explicit confirmation-code-invalid-or-expired message. This does not
establish a proxy, user-agent, mailbox, or session root cause.

The browser adapter returned `otp` whenever an OTP field was present, before
checking errors. The runner then continued automatic mailbox polling. A synthetic
mobile page with the exact rejection message reproduced the misclassification.

## Final change

- [x] Detect the explicit invalid/expired message with an OTP field as `otp_rejected`.
- [x] Pause the runner, clear pending OTP, and disable automatic OTP after rejection.
- [x] Expose source, message ID, device, selection/submission/rejection timestamps
  without putting the code into diagnostics.
- [x] Render diagnosis metadata and a resume control in the existing panel.
- [x] Document restart and same-window manual recovery; retain the existing send
  behavior, proxy, user agent, and registration URL.

Tests were written and observed failing before implementation for rejection
classification, pausing, and UI diagnostics. A proposed automatic-submission
heuristic was removed after review found possible false detections and a timing
race; it is not part of the final change.

## Verification

Run `node --test test/*.test.cjs` in `ig-tool`. The final tool suite has 29 tests.
Synthetic pages only; no actual account registration, proxy use, or mailbox access
was performed for this fix. Live OTP rejection remains unproven and needs a fresh
attempt with the diagnostic information, not a claim that the platform issue is fixed.

Follow-up: the user confirms the latest email code also fails. Add a passive
network observer before navigation, retaining at most 12 same-origin fetch/XHR
mutation summaries. Store only stage categories, timestamps, HTTP status, `ok`/
`fail`, and fixed error enums from error fields. Never store request bodies,
URLs/query strings, arbitrary response text, OTP, or cookies. UI shows the last
four events, including manual confirmation while the runner is paused. New tests
exercise a real mobile fixture returning HTTP 200 with `invalid_nonce`, response
sanitization, and send/verify route categorization. This records evidence on the
next user-run session and does not replay or change platform requests.

Follow-up 2: the user clarifies that manual registration succeeds in Chrome with
DevTools mobile emulation. The tool instead used Chromium with an iPhone Safari
User-Agent, a page-scoped CDP override, and CSS zoom. Replace those manual mobile
overrides with Playwright's built-in Pixel 7 profile (defaultBrowserType Chromium),
leave proxy, registration URL, and OTP workflow unchanged, and rename the option
to Chrome Android. A real-browser regression test failed on the old Safari UA and
checks HTTP/JS UA equality, Chrome/Android identity, touch, and mobile viewport.
This fixes a demonstrated configuration mismatch; live Instagram OTP acceptance
is not established by the synthetic test. Final tool suite: 30 tests.

Follow-up 3: user confirms the successful manual Chrome-mobile run uses the same
proxy and starts at Instagram home, then clicks Sign up. A real failed tool run
retained HTTP 200 registration responses without recognized error enums and two
HTTP 429 responses categorized as other; those do not establish that the OTP
endpoint was rate limited. Tool previously entered `/accounts/signup/email/`
directly. Add `navigateToRegistration` to follow the actual homepage signup link
for mobile in the same context; preserve desktop, proxy and OTP logic. Local
fixture verifies home initialization cookie survives the signup-link transition.
This test verifies navigation/session behavior, not live OTP acceptance. Final
tool suite: 33 tests after live-navigation corrections below.

Read-only live verification through the saved proxy found that home exposes a
signup button, not an anchor. That button leads to `/accounts/signup/phone` with
a `Đăng ký bằng email` button. Correct the helper to support buttons/links and
follow the phone-to-email transition in the same context. Add failing-then-passing
fixtures for both actual differences, including preservation of an initialization
cookie from the intermediate phone step. No account data or OTP was submitted
during these checks.

Final verification: 33/33 tool tests pass; `git diff --check` is clean. A live
read-only run through the saved proxy followed home -> signup button -> phone
step -> email button and ended at `/accounts/signup/email/` with one visible
input and no phone field. Live OTP acceptance remains unverified because the
check did not submit account data or a confirmation code.

Follow-up 4: user reaches the mobile birthday screen, while the tool still shows
waiting for OTP. A native `input[type=date][inputmode=numeric]` fixture reproduces
the issue: the blanket numeric OTP selector matches the birthday field. Remove
that generic selector, prioritize native date detection, and fill date inputs with
the requested ISO date plus blur and value verification. Preserve support for the
three select/custom birthday controls. Set runner status to working while filling
the date so stale OTP controls disappear. Browser and runner regression tests were
observed failing before the fix; final tool suite is 35/35 passing, diff check clean.

Follow-up 5: username remains on screen after typing and mobile signup has an
explicit Terms/Policies screen with `Tôi đồng ý`. Replace the completed-step flag
with pending-step tracking. Username gets one bounded Next retry without refilling
the field and restarting availability validation; other steps are not blindly
resubmitted. Detect consent only within Instagram signup with matching signup text,
click once, and allow up to 60 seconds for authenticated identity confirmation.
Do not expose a successful result or enable warehouse confirmation during loading.
The existing UI's Xác nhận remains the save operation, preserving retryable failed
writes and username matching. Added real-browser username/terms/loading/identity
fixture and runner regression, both observed failing before the change.
Verification: 37/37 tool tests pass; diff check clean. Review found no important
issues. No live account or consent was submitted during automated verification.

The root suite has the same 10 pre-existing failures (37/47 pass):

- Outlook import recognizes both client ID and refresh token orders
- public key cannot read mail
- non-member cannot query stored mailbox or Microsoft
- read messages with stored credentials, rotate token only on backend
- email and password alone explain OAuth requirement
- expired or revoked refresh token requests reconnection
- repeated polling returns independent response streams
- missing resource is denied without requesting Microsoft
- Graph 401 retries once with refreshed access token
- concurrent readers share refresh and Graph operation
