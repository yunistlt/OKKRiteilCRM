-- Quick verification for 20260414_rbac_profiles_rls.sql

select 'type_exists' as check_name, exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role'
) as ok;

select 'profiles_exists' as check_name, exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles'
) as ok;

select policyname, tablename, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'orders',
    'okk_order_scores',
    'order_metrics',
    'call_order_matches',
    'raw_order_events',
    'raw_telphin_calls',
    'order_history_log',
    'okk_violations',
    'okk_consultant_threads',
    'okk_consultant_messages',
    'okk_consultant_logs'
  )
order by tablename, policyname;

select
  u.id,
  u.email,
  p.username,
  p.role,
  p.retail_crm_manager_id,
  u.raw_app_meta_data
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc
limit 20;