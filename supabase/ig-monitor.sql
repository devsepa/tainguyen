-- Run once as postgres. No resource IDs are changed; no secrets leave Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.secrets where name='mxh_ig_scan_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'mxh_ig_scan_token');
  end if;
end $$;

create or replace function public.mxh_verify_ig_scan_token(candidate text)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets where name='mxh_ig_scan_token' and decrypted_secret=candidate and length(candidate)=64);
$$;
revoke all on function public.mxh_verify_ig_scan_token(text) from public,anon,authenticated;
grant execute on function public.mxh_verify_ig_scan_token(text) to service_role;

create or replace function public.mxh_ig_scan_queue()
returns table(uid text,data jsonb,revision bigint)
language sql security definer set search_path='' as $$
  select r.uid,r.data,r.revision from public.mxh_resources r
  where r.data->>'platform'='instagram'
  and coalesce(r.data->'igCheck'->>'at','') < to_char(now() at time zone 'UTC' - interval '6 hours','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  order by coalesce(r.data->'igCheck'->>'at',''),r.uid limit 3;
$$;
revoke all on function public.mxh_ig_scan_queue() from public,anon,authenticated;
grant execute on function public.mxh_ig_scan_queue() to service_role;

create or replace function public.mxh_save_ig_check(resource_uid text, expected_revision bigint, patch jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare summary jsonb; saved_days jsonb; day_key text := to_char(now() at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD');
begin
  if jsonb_typeof(patch) <> 'object' or not(patch ? 'igCheck') or
    exists(select 1 from jsonb_object_keys(patch) k where k not in ('igCheck','igId','igUsername','status','checked')) then
    raise exception 'Invalid IG patch';
  end if;
  update public.mxh_resources set data = data || patch || jsonb_build_object('updated',floor(extract(epoch from clock_timestamp())*1000))
  where uid=resource_uid and revision=expected_revision and data->>'platform'='instagram';
  if not found then return false; end if;
  insert into public.mxh_meta(key,data) values('daily','{"days":{}}') on conflict(key) do nothing;
  select coalesce(data->'days','{}') into saved_days from public.mxh_meta where key='daily' for update;
  select coalesce(jsonb_object_agg(s,n),'{}') into summary from (
    select coalesce(nullif(status,''),'new') s,count(*) n from public.mxh_resources group by coalesce(nullif(status,''),'new')
  ) counts;
  saved_days := jsonb_set(saved_days,array[day_key],summary,true);
  select coalesce(jsonb_object_agg(key,value),'{}') into saved_days from (select key,value from jsonb_each(saved_days) order by key desc limit 90) recent;
  update public.mxh_meta set data=jsonb_build_object('days',saved_days) where key='daily' and data is distinct from jsonb_build_object('days',saved_days);
  return true;
end $$;
revoke all on function public.mxh_save_ig_check(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.mxh_save_ig_check(text,bigint,jsonb) to service_role;

select cron.schedule('mxh-ig-monitor','*/5 * * * *', $job$
  select net.http_post(
    url:='https://uecdimszburryafqtszf.supabase.co/functions/v1/check-ig',
    headers:=jsonb_build_object('Content-Type','application/json','x-scan-token',(select decrypted_secret from vault.decrypted_secrets where name='mxh_ig_scan_token')),
    body:='{}'::jsonb,timeout_milliseconds:=65000
  );
$job$);
