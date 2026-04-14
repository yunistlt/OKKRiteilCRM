# Применение миграции RBAC

Файл миграции:

- [migrations/20260414_rbac_profiles_rls.sql](migrations/20260414_rbac_profiles_rls.sql)

## Как запускать

1. Откройте Supabase Dashboard.
2. Перейдите в SQL Editor.
3. Выполните preflight-проверки ниже.
4. Откройте файл [migrations/20260414_rbac_profiles_rls.sql](migrations/20260414_rbac_profiles_rls.sql).
5. Скопируйте весь SQL из файла целиком в SQL Editor.
6. Запустите его одним блоком.
7. Выполните post-check SQL из этого документа.

## Preflight

Сначала проверьте, что у проекта есть базовые таблицы и что auth.users доступна:

```sql
select current_database() as db_name, current_user as db_user;

select table_schema, table_name
from information_schema.tables
where (table_schema = 'auth' and table_name = 'users')
   or (table_schema = 'public' and table_name in (
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
      'okk_consultant_logs',
      'users'
   ))
order by table_schema, table_name;
```

Если `auth.users` не видна или SQL Editor не даёт прав на `auth`, миграцию лучше запускать под владельцем проекта в Supabase Dashboard.

## Основная миграция

Запускается файл:

- [migrations/20260414_rbac_profiles_rls.sql](migrations/20260414_rbac_profiles_rls.sql)

Важно:

- Не разбивайте файл на куски без необходимости.
- Внутри есть `DO $$ ... $$` блоки и триггеры, их лучше выполнять одним запуском.
- Миграция сделана максимально идемпотентной: повторный запуск не должен ломать схему.

## Post-check

Проверьте, что создались тип, таблица profiles, функции и триггеры:

```sql
select t.typname
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'app_role';

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'profiles';

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'handle_new_auth_user',
    'sync_profile_claims_to_auth',
    'jwt_role',
    'jwt_retail_crm_manager_id',
    'has_full_order_access',
    'can_access_manager_row',
    'can_access_order'
  )
order by routine_name;

select trigger_name, event_object_table
from information_schema.triggers
where event_object_schema in ('public', 'auth')
  and trigger_name in (
    'on_auth_user_created_profiles',
    'trg_profiles_sync_claims',
    'trg_profiles_updated_at'
  )
order by event_object_table, trigger_name;
```

Проверьте, что на ключевых таблицах появились RLS policy:

```sql
select schemaname, tablename, policyname, cmd
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
```

Проверьте, что profiles синхронизировались хотя бы для уже существующих auth.users:

```sql
select count(*) as auth_users from auth.users;
select count(*) as profiles_count from public.profiles;

select id, email, username, role, retail_crm_manager_id
from public.profiles
order by created_at desc
limit 20;
```

## Ручная проверка claim-ов

После миграции для тестового пользователя обновите строку в `public.profiles`, затем перелогиньтесь и проверьте, что в JWT есть:

- `role`
- `retail_crm_manager_id`
- `username`
- `first_name`
- `last_name`

Для быстрой проверки можно посмотреть `raw_app_meta_data`:

```sql
select
  u.id,
  u.email,
  u.raw_app_meta_data,
  p.role,
  p.retail_crm_manager_id
from auth.users u
join public.profiles p on p.id = u.id
order by u.created_at desc
limit 20;
```

## Тестовые роли

Минимально проверьте 4 сценария:

1. `admin` видит все заказы и раздел `/settings`.
2. `okk` видит `/okk`, аналитику и аудит консультанта, но не системные настройки.
3. `rop` видит `/reactivation` и аналитику, но не `/settings`.
4. `manager` видит только свои заказы и не видит общую статистику отдела.

## Если миграция падает

Сохраните текст ошибки и отдельно проверьте:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
order by ordinal_position;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'users'
order by ordinal_position;
```

Самые вероятные причины:

- нестандартная схема `orders` без `manager_id`
- legacy `users` отличается по полям от ожидаемой формы
- миграция запускается не под тем уровнем прав в SQL Editor

## Что делать сразу после применения

1. Создать тестовых пользователей в `auth.users`.
2. Назначить им роли и `retail_crm_manager_id` в `public.profiles`.
3. Перелогиниться под каждым пользователем.
4. Проверить UI и API-ограничения в приложении.