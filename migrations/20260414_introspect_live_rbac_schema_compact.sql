-- Compact live schema introspection for RBAC migration.
-- Run this whole query in Supabase SQL Editor and send the single JSON result.

select jsonb_pretty(
  jsonb_build_object(
    'columns', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.table_schema, t.table_name, t.ordinal_position), '[]'::jsonb)
      from (
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
          ('auth', 'users')
        )
      ) t
    ),
    'policies', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.schemaname, t.tablename, t.policyname), '[]'::jsonb)
      from (
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
          ('public', 'order_history_log')
        )
      ) t
    ),
    'rls_state', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.schemaname, t.tablename), '[]'::jsonb)
      from (
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
            ('public', 'order_history_log')
          )
      ) t
    ),
    'triggers', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.table_schema, t.table_name, t.trigger_name, t.event_manipulation), '[]'::jsonb)
      from (
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
      ) t
    ),
    'functions', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.schema_name, t.function_name), '[]'::jsonb)
      from (
        select
          n.nspname as schema_name,
          p.proname as function_name,
          pg_get_function_identity_arguments(p.oid) as args,
          pg_get_function_result(p.oid) as result_type
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
      ) t
    ),
    'auth_users_sample', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select
          id,
          email,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at
        from auth.users
        order by created_at desc
        limit 5
      ) t
    )
  )
) as live_rbac_schema_json;