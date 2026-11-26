# Outlook / Hotmail inbox

Import `email|password|refresh_token|client_id` in Kho Gmail. The reverse order `email|password|client_id|refresh_token` is also recognized. OAuth tokens must belong to an application/user authorized for Microsoft Graph `Mail.Read`; IMAP-only authorization is insufficient. Email/password alone can be stored but cannot read mail through this integration.

Open Hộp thư & OTP from the imported row. The browser sends its Supabase session token and resource UID only. The function verifies Auth, membership and RLS access before loading the mailbox OAuth credentials. It reads the latest 20 messages, including messages outside Inbox, and the existing UI extracts OTP codes. Outlook polls every 10 seconds while the dialog is open. Closing it stops polling.

Deploy `outlook-tokens.sql` before `read-hotmail`. Platform legacy JWT verification stays off because the handler validates the actual user session through Supabase Auth. A publishable key is not a user bearer token.

`mxh_outlook_tokens` has RLS, no anon/authenticated grants, and service-role-only access. It holds the current refresh/access token, expiry and a hash of the imported credentials. Refresh token rotation stays on the backend, avoiding resource revision conflicts. Importing different OAuth credentials invalidates the cache. Removing a mailbox cascades deletion of cached tokens.

The existing shared resource store still contains the initially imported credentials; members granted access to that store can read them. This follows the existing shared-inventory access model, not individual mailbox ownership.

This does not register a Microsoft application or implement a new Microsoft sign-in consent flow. That requires an app Client ID and redirect configuration. Invalid/revoked tokens and missing Graph consent produce an explicit reconnection/permission message.

Tests: `node --test hotmail.test.cjs` plus the existing UI/store/IG tests. Microsoft responses are mocked: a real authorized mailbox is required to confirm end-to-end delivery. Never paste tokens or passwords into logs, screenshots or chat.
