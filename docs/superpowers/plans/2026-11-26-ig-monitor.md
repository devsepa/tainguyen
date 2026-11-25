# Instagram monitoring

Goal: Verify profiles conservatively, retain a stable Instagram ID without renaming database keys, record every attempt, and refresh the browser automatically.

Architecture: Shared, tested profile checker used by the authenticated Edge Function. JSON fields igId, igUsername and igCheck preserve the existing resource primary key. Unknown or missing profiles never overwrite confirmed account status. UID lookup is best effort through an undocumented endpoint; failure falls back to the saved username and checks identity.

Approaches: Browser-only requests are blocked by cross-origin restrictions. A server checker fits the existing Supabase function and was selected. A third-party paid checker is not configured.

Tasks:
- [x] Add regression tests for 404, generic HTML, identity mismatch, rename and timeouts.
- [x] Implement shared checker and member authentication; integrate metadata in single, batch and background checks.
- [x] Add a bounded scheduled scanner, optimistic writes and browser refresh if supported by project configuration.
- [x] Run local tests, deploy function, verify unauthorized access and document limitations.

No migrations of resource keys or destructive cleanup. No claim that a personal Instagram profile is permanently dead based on a public lookup.

Verification: 33 Node tests and interaction checks passed. Deployed check-ig v3. Cron invocation returned HTTP 200 with an empty due queue. Transactional save, daily summary and stale-revision rejection verified in a rolled-back database test. Anonymous HTTP call returned 401. Live Instagram lookup returned Unknown/upstream_404; successful personal-profile lookup is not guaranteed. Local frontend source has not been published.
