# IG monitoring

`check-ig` validates a signed-in editor/admin using Supabase Auth and membership. Its platform JWT toggle remains off because verification is performed in the handler. Send a session access token, never a publishable key as the bearer token.

The checker uses undocumented Instagram endpoints. Access may be blocked; it cannot guarantee identification of personal accounts. Only a structured response with a numeric ID and matching username/previous ID proves Live. A raw 404, login restriction, rate limit or timeout is Unknown. An explicit null user is Not found, never permanent Die. Generic HTML is not accepted as proof.

Resource keys are preserved. `igId` stores numeric identity; `igUsername` stores the last verified name; `igCheck` stores the result, reason and UTC attempt timestamp. Unknown results preserve the previous confirmed status. Displayed status and latest lookup result are deliberately separate.

`ig-monitor.sql` configures a Vault token, service-only RPCs and the `mxh-ig-monitor` cron job. Every five minutes the scanner processes up to three oldest IG records not attempted within six hours. Large inventories can take longer to revisit. The job runs while the website is closed, subject to Supabase availability and project limits. Browser auto-check preference controls browser scans only; to pause the server job use `select cron.alter_job((select jobid from cron.job where jobname='mxh-ig-monitor'), active := false);` as project owner.

Writes compare the resource revision and merge only checker fields. A successful scan also updates daily statistics in the same transaction. Browser refresh runs every 30 seconds, skips forms, selection and active writes, and discards stale snapshots after writes or session changes.

Verification: `node --test ig-check.test.cjs cloud-ui.test.cjs supabase-store.test.cjs` and `node interaction-check.cjs`. Tests mock Instagram responses; live public lookups may remain Unknown. Function deployment does not publish the local website source.
