# Domain Mail Implementation Plan

**Goal:** A dedicated Mail domain tab creates aliases and reads mail without the local tool.
**Approved design:** Cloudflare Email Worker parses inbound mail, sends it to an authenticated ingest endpoint, then forwards to the existing verified Gmail destination. Supabase stores registered aliases and mail. Existing warehouse membership authorizes reads; editors/admins create aliases. No Gmail password is stored in the frontend.
**Tech:** Existing HTML app, browser JS module, Supabase Edge Functions/Postgres, Cloudflare Email Workers.

- [x] Add tests for authenticated mailbox operations, ingest validation, deduplication, forwarding and frontend behavior.
- [x] Implement tables with RLS and bounded message storage, plus an Edge Function with member checks and a server-only ingest secret.
- [x] Implement the Email Worker with MIME parsing and Gmail forwarding; document secrets and route changes.
- [x] Add the Mail domain tab, alias creation/listing, message list and sandboxed body reader. Dispose listeners on navigation.
- [x] Fix the confirmed settings typo, run focused and full tests, report deployment gaps separately.

Validation: 13/13 domain-mail tests passed; Wrangler deploy --dry-run passed; actual PostalMime parser smoke passed. Full D: suite 105/115 passed, with 10 existing Outlook failures remaining. Settings regression now passes. No online deployment or DNS/routing changes performed. Supabase connector still returns token_revoked; final peer-review agent also could not authenticate. Additive SQL setup follows existing repository setup scripts; no migration was applied.

Deployment is a separate verification step: current connector authentication is revoked. Do not claim online delivery until a real routed test message reaches the new inbox. Never copy local credentials to the website.
