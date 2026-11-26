-- Server-only OAuth cache. No browser or normal member can read these tokens.
create table public.mxh_outlook_tokens (
  resource_uid text primary key references public.mxh_resources(uid) on delete cascade,
  source_hash text not null,
  refresh_token text not null,
  access_token text not null,
  expires_at timestamptz not null
);
alter table public.mxh_outlook_tokens enable row level security;
revoke all on public.mxh_outlook_tokens from public,anon,authenticated;
grant select,insert,update,delete on public.mxh_outlook_tokens to service_role;
