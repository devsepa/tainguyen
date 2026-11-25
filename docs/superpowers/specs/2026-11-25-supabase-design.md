# Supabase shared storage

User-approved direction: retain GitHub Pages, use Supabase Free PostgreSQL instead of browser-only storage. Keep master-password removal and existing account fields. Never place account records or server secrets in GitHub.

Approaches considered: Supabase (chosen for SQL familiarity and relational queries), Firestore (document model), localStorage (cannot share between devices).

Prepare a storage adapter and SQL migration independently of account setup. Store each account as one row with UID, JSONB payload and server-generated revision; expose generated email, status and group columns for SQL queries. Store settings/daily summaries separately. Serialize transactional batch writes and compare revisions to reject stale updates/deletes. Fetch in pages beyond the default API row limit. Never automatically upload local data, clear it, or silently fall back to local storage after a cloud failure.

Confirmed access scope: only explicitly added members; anonymous clients have no data access. Approved Supabase project: `uecdimszburryafqtszf`, Free tier. Auth uses owner-created email/password accounts, separately from the removed master-password encryption feature. Only publishable/legacy anon keys may be shipped in browser code. No paid plan or billing changes are authorized.

Supabase now computes daily counts inside each transaction using all committed server rows. This avoids stale browser snapshots corrupting shared statistics. Explicit refresh retrieves changes from other users. UI writes wait for the server and do not silently fall back to local storage.

The schema, auth membership, and transactional checks have been verified on the real project. Owner password stays with the user; browser authentication UI and CRUD interactions are tested using a mock-member session. Publish all source files atomically after these checks; preserve browser data for explicit migration.
