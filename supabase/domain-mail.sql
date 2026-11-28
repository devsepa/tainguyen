-- Additive setup script, run after schema.sql in the Supabase SQL Editor.
begin;
create table if not exists public.mxh_domain_mailboxes (
  email text primary key check(length(email)<=254 and email=lower(email)),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.mxh_domain_messages (
  id uuid primary key default gen_random_uuid(),
  recipient text not null references public.mxh_domain_mailboxes(email) on delete cascade,
  source_id text not null check(source_id ~ '^[a-f0-9]{64}$'),
  sender text not null check(length(sender)<=2000),
  subject text not null check(length(subject)<=2000),
  body text not null check(length(body)<=131072),
  body_type text not null check(body_type in ('html','text')),
  received_at timestamptz not null default now(),
  unique(recipient,source_id)
);
create index if not exists mxh_domain_messages_recipient_time on public.mxh_domain_messages(recipient,received_at desc);
alter table public.mxh_domain_mailboxes enable row level security;
alter table public.mxh_domain_messages enable row level security;
revoke all on public.mxh_domain_mailboxes,public.mxh_domain_messages from anon,authenticated;
grant select on public.mxh_domain_mailboxes,public.mxh_domain_messages to authenticated;
grant all on public.mxh_domain_mailboxes,public.mxh_domain_messages to service_role;
drop policy if exists mxh_domain_member_boxes on public.mxh_domain_mailboxes;
create policy mxh_domain_member_boxes on public.mxh_domain_mailboxes for select to authenticated
using(exists(select 1 from public.mxh_members where user_id=(select auth.uid())));
drop policy if exists mxh_domain_member_messages on public.mxh_domain_messages;
create policy mxh_domain_member_messages on public.mxh_domain_messages for select to authenticated
using(exists(select 1 from public.mxh_members where user_id=(select auth.uid())));
commit;
