-- Supabase Free. Run in the project's SQL Editor; no billing changes required.
-- Anonymous access is deliberately not enabled. Choose the access model first.
begin;

create sequence if not exists public.mxh_revision_seq maxvalue 9007199254740991;

create table if not exists public.mxh_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor','admin')) default 'viewer'
);

create table if not exists public.mxh_resources (
  uid text primary key check (uid ~ '^[A-Za-z0-9._-]{1,60}$' and left(uid,2) <> '__'),
  data jsonb not null check (jsonb_typeof(data)='object' and data ? 'uid' and data->>'uid'=uid),
  email text generated always as (data->>'email') stored,
  status text generated always as (data->>'status') stored,
  group_name text generated always as (data->>'group') stored,
  revision bigint not null default nextval('public.mxh_revision_seq'),
  updated_at timestamptz not null default now(),
  check (octet_length(data::text) <= 250000)
);
create index if not exists mxh_resources_status_idx on public.mxh_resources(status);
create index if not exists mxh_resources_group_idx on public.mxh_resources(group_name);

create table if not exists public.mxh_meta (
  key text primary key check (key in ('settings','daily')),
  data jsonb not null check (jsonb_typeof(data)='object'),
  revision bigint not null default nextval('public.mxh_revision_seq'),
  updated_at timestamptz not null default now(),
  check (octet_length(data::text) <= 250000)
);

create or replace function public.mxh_set_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  new.revision := nextval('public.mxh_revision_seq');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists mxh_resources_revision on public.mxh_resources;
create trigger mxh_resources_revision before insert or update on public.mxh_resources
for each row execute function public.mxh_set_revision();
drop trigger if exists mxh_meta_revision on public.mxh_meta;
create trigger mxh_meta_revision before insert or update on public.mxh_meta
for each row execute function public.mxh_set_revision();

alter table public.mxh_members enable row level security;
alter table public.mxh_resources enable row level security;
alter table public.mxh_meta enable row level security;

revoke all on public.mxh_members,public.mxh_resources,public.mxh_meta from anon,authenticated;
grant select on public.mxh_members to authenticated;
grant select,insert,update,delete on public.mxh_resources,public.mxh_meta to authenticated;
grant usage on sequence public.mxh_revision_seq to authenticated;

drop policy if exists mxh_member_self on public.mxh_members;
create policy mxh_member_self on public.mxh_members for select to authenticated
using(user_id=(select auth.uid()));

drop policy if exists mxh_read_resources on public.mxh_resources;
create policy mxh_read_resources on public.mxh_resources for select to authenticated
using(exists(select 1 from public.mxh_members where user_id=(select auth.uid())));
drop policy if exists mxh_write_resources on public.mxh_resources;
create policy mxh_write_resources on public.mxh_resources for all to authenticated
using(exists(select 1 from public.mxh_members where user_id=(select auth.uid()) and role in ('editor','admin')))
with check(exists(select 1 from public.mxh_members where user_id=(select auth.uid()) and role in ('editor','admin')));

drop policy if exists mxh_read_meta on public.mxh_meta;
create policy mxh_read_meta on public.mxh_meta for select to authenticated
using(exists(select 1 from public.mxh_members where user_id=(select auth.uid())));
drop policy if exists mxh_write_meta on public.mxh_meta;
create policy mxh_write_meta on public.mxh_meta for all to authenticated
using(exists(select 1 from public.mxh_members where user_id=(select auth.uid()) and role in ('editor','admin')))
with check(exists(select 1 from public.mxh_members where user_id=(select auth.uid()) and role in ('editor','admin')));

-- All changes in one call succeed together or roll back together.
-- Server-generated revisions prevent stale clients from overwriting newer data.
create or replace function public.mxh_apply(resource_changes jsonb default '[]',meta_changes jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  change jsonb;
  current_resource public.mxh_resources%rowtype;
  current_meta public.mxh_meta%rowtype;
  resource_result jsonb := '[]';
  meta_result jsonb := '[]';
  exists_now boolean;
  next_revision bigint;
  payload jsonb;
  day_key text;
  day_counts jsonb;
  saved_days jsonb;
begin
  if not exists(select 1 from public.mxh_members where user_id=auth.uid() and role in ('editor','admin')) then
    raise exception 'Write access denied' using errcode='42501';
  end if;
  if jsonb_typeof(resource_changes) is distinct from 'array' or jsonb_typeof(meta_changes) is distinct from 'array' then
    raise exception 'Expected arrays' using errcode='22023';
  end if;
  if jsonb_array_length(resource_changes)>1000 or jsonb_array_length(meta_changes)>2 then
    raise exception 'Batch too large' using errcode='22023';
  end if;
  -- A short transaction-wide lock also handles simultaneous insertion of a new UID.
  perform pg_catalog.pg_advisory_xact_lock(20261125,1);
  for change in select value from jsonb_array_elements(resource_changes) loop
    if not(change ? 'uid' and change ? 'expected' and change ? 'data') then
      raise exception 'Invalid resource change' using errcode='22023';
    end if;
    select * into current_resource from public.mxh_resources where uid=change->>'uid' for update;
    exists_now := found;
    if change->'data'='null'::jsonb then
      if exists_now then
        if current_resource.revision is distinct from (change->>'expected')::bigint then
          raise exception 'Revision conflict for UID %',change->>'uid' using errcode='40001';
        end if;
        delete from public.mxh_resources where uid=change->>'uid';
      end if;
      resource_result := resource_result || jsonb_build_array(jsonb_build_object('uid',change->>'uid','revision',null));
    else
      if exists_now and current_resource.data=change->'data' then
        next_revision := current_resource.revision; -- Retry after a lost response is safe.
      else
        if exists_now and current_resource.revision is distinct from (change->>'expected')::bigint
          or not exists_now and change->>'expected' is not null then
          raise exception 'Revision conflict for UID %',change->>'uid' using errcode='40001';
        end if;
        if exists_now then
          update public.mxh_resources set data=change->'data' where uid=change->>'uid' returning revision into next_revision;
        else
          insert into public.mxh_resources(uid,data) values(change->>'uid',change->'data') returning revision into next_revision;
        end if;
      end if;
      resource_result := resource_result || jsonb_build_array(jsonb_build_object('uid',change->>'uid','revision',next_revision));
    end if;
  end loop;
  for change in select value from jsonb_array_elements(meta_changes) loop
    if not(change ? 'key' and change ? 'expected' and change ? 'data') or change->'data'='null'::jsonb then
      raise exception 'Invalid metadata change' using errcode='22023';
    end if;
    select * into current_meta from public.mxh_meta where key=change->>'key' for update;
    exists_now := found;
    payload := change->'data';
    if change->>'key'='daily' then
      day_key := payload->>'day';
      if day_key is null or day_key !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Invalid summary day' using errcode='22023';
      end if;
      perform day_key::date;
      select coalesce(jsonb_object_agg(s,n),'{}'::jsonb) into day_counts from (
        select coalesce(nullif(status,''),'new') s,count(*) n from public.mxh_resources
        group by coalesce(nullif(status,''),'new')
      ) totals;
      saved_days := jsonb_set(coalesce(current_meta.data->'days','{}'::jsonb),array[day_key],day_counts,true);
      select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into saved_days from (
        select key,value from jsonb_each(saved_days) order by key desc limit 90
      ) recent;
      payload := jsonb_build_object('days',saved_days);
    end if;
    if exists_now and current_meta.data=payload then
      next_revision := current_meta.revision;
    else
      if exists_now and current_meta.revision is distinct from (change->>'expected')::bigint
        or not exists_now and change->>'expected' is not null then
        raise exception 'Revision conflict for metadata %',change->>'key' using errcode='40001';
      end if;
      if exists_now then
        update public.mxh_meta set data=payload where key=change->>'key' returning revision into next_revision;
      else
        insert into public.mxh_meta(key,data) values(change->>'key',payload) returning revision into next_revision;
      end if;
    end if;
    meta_result := meta_result || jsonb_build_array(jsonb_build_object('key',change->>'key','revision',next_revision,'data',payload));
  end loop;
  return jsonb_build_object('resources',resource_result,'meta',meta_result);
end $$;
revoke all on function public.mxh_apply(jsonb,jsonb) from public,anon;
grant execute on function public.mxh_apply(jsonb,jsonb) to authenticated;
commit;

-- After configuring Auth and confirming access scope, the project owner can add
-- a member through SQL Editor (never execute this with an unconfirmed user ID):
-- insert into public.mxh_members(user_id,role) values ('<AUTH-USER-UUID>','admin');
-- Query example: select uid,email,status,group_name from public.mxh_resources;
