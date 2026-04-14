-- Live schema introspection for RBAC migration alignment.
-- Run in Supabase SQL Editor and send the full Results output.

-- 1. Target tables presence
select
  n.nspname as schema_name,
  c.relname as object_name,
  c.relkind as object_kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches'),
  ('public', 'raw_order_events'),
  ('public', 'raw_telphin_calls'),
  ('public', 'okk_violations'),
  ('public', 'order_history_log'),
  ('public', 'okk_consultant_threads'),
  ('public', 'okk_consultant_messages'),
  ('public', 'okk_consultant_logs'),
  ('public', 'managers'),
  ('auth', 'users')
)
order by schema_name, object_name;

-- 2. Columns for all relevant tables
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where (table_schema, table_name) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches'),
  ('public', 'raw_order_events'),
  ('public', 'raw_telphin_calls'),
  ('public', 'okk_violations'),
  ('public', 'order_history_log'),
  ('public', 'okk_consultant_threads'),
  ('public', 'okk_consultant_messages'),
  ('public', 'okk_consultant_logs'),
  ('public', 'managers'),
  ('auth', 'users')
)
order by table_schema, table_name, ordinal_position;

-- 3. Enum types relevant to RBAC
select
  n.nspname as schema_name,
  t.typname as type_name,
  e.enumsortorder,
  e.enumlabel
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
  and t.typname in ('app_role')
order by schema_name, type_name, e.enumsortorder;

-- 4. Constraints and foreign keys
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
left join information_schema.constraint_column_usage ccu
  on tc.constraint_schema = ccu.constraint_schema
 and tc.constraint_name = ccu.constraint_name
where (tc.table_schema, tc.table_name) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches'),
  ('public', 'raw_order_events'),
  ('public', 'raw_telphin_calls'),
  ('public', 'okk_violations'),
  ('public', 'order_history_log'),
  ('public', 'okk_consultant_threads'),
  ('public', 'okk_consultant_messages'),
  ('public', 'okk_consultant_logs'),
  ('public', 'managers')
)
order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- 5. Indexes
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where (schemaname, tablename) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches'),
  ('public', 'raw_order_events'),
  ('public', 'raw_telphin_calls'),
  ('public', 'okk_violations'),
  ('public', 'order_history_log'),
  ('public', 'okk_consultant_threads'),
  ('public', 'okk_consultant_messages'),
  ('public', 'okk_consultant_logs'),
  ('public', 'managers')
)
order by schemaname, tablename, indexname;

-- 6. RLS state
select
  n.nspname as schemaname,
  c.relname as tablename,
  c.relrowsecurity as rowsecurity,
  c.relforcerowsecurity as forcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and (n.nspname, c.relname) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches'),
  ('public', 'raw_order_events'),
  ('public', 'raw_telphin_calls'),
  ('public', 'okk_violations'),
  ('public', 'order_history_log'),
  ('public', 'okk_consultant_threads'),
  ('public', 'okk_consultant_messages'),
  ('public', 'okk_consultant_logs')
)
order by schemaname, tablename;

-- 7. Existing RLS policies
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where (schemaname, tablename) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches'),
  ('public', 'raw_order_events'),
  ('public', 'raw_telphin_calls'),
  ('public', 'okk_violations'),
  ('public', 'order_history_log'),
  ('public', 'okk_consultant_threads'),
  ('public', 'okk_consultant_messages'),
  ('public', 'okk_consultant_logs')
)
order by schemaname, tablename, policyname;

-- 8. Triggers on relevant tables and auth.users
select
  event_object_schema as table_schema,
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where (event_object_schema, event_object_table) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('auth', 'users')
)
order by table_schema, table_name, trigger_name, event_manipulation;

-- 9. Functions that may affect RBAC or claims
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result_type,
  pg_get_functiondef(p.oid) as function_def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'handle_new_auth_user',
    'sync_profile_claims_to_auth',
    'jwt_role',
    'jwt_retail_crm_manager_id',
    'has_full_order_access',
    'can_access_manager_row',
    'can_access_order',
    'set_current_timestamp_updated_at'
  )
order by schema_name, function_name;

-- 10. Grants on core tables
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where (table_schema, table_name) in (
  ('public', 'users'),
  ('public', 'profiles'),
  ('public', 'orders'),
  ('public', 'okk_order_scores'),
  ('public', 'order_metrics'),
  ('public', 'call_order_matches')
)
and grantee in ('anon', 'authenticated', 'service_role')
order by table_schema, table_name, grantee, privilege_type;

-- 11. Lightweight auth.users sample for shape verification
select
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
from auth.users
order by created_at desc
limit 5;