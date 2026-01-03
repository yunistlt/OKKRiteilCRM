# Инструкция по применению миграции RAW-слоя

## Способ 1: Через Supabase Dashboard (Рекомендуется)

1. Откройте Supabase Dashboard: https://supabase.com/dashboard
2. Выберите ваш проект
3. Перейдите в **SQL Editor**
4. Скопируйте содержимое файла `migrations/20260103_raw_layer.sql`
5. Вставьте в редактор и нажмите **Run**

## Способ 2: Через psql (если есть доступ)

```bash
# Установите переменную DATABASE_URL
export DATABASE_URL="postgresql://..."

# Выполните миграцию
psql "$DATABASE_URL" -f migrations/20260103_raw_layer.sql
```

## Способ 3: Через Supabase CLI

```bash
# Если установлен Supabase CLI
supabase db push

# Или напрямую
supabase db execute -f migrations/20260103_raw_layer.sql
```

## Проверка успешности миграции

После выполнения миграции проверьте:

```bash
npm run verify:raw-tables
```

Или вручную:

```sql
-- Проверка таблиц
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('raw_order_events', 'raw_telphin_calls');

-- Проверка индексов
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('raw_order_events', 'raw_telphin_calls');
```

## Что создаётся

### Таблицы:
- ✅ `raw_order_events` - события из RetailCRM (append-only)
- ✅ `raw_telphin_calls` - звонки из Telphin (append-only)

### Индексы:
- По `retailcrm_order_id`, `occurred_at`, `event_type`
- По `telphin_call_id`, `started_at`, `from/to_number_normalized`

### Constraints:
- UNIQUE для идемпотентности
- CHECK для direction (incoming/outgoing)

## Следующие шаги

После успешного создания таблиц:
1. Миграция данных из `order_history` → `raw_order_events`
2. Миграция данных из `calls` → `raw_telphin_calls`
3. Обновление синков на append-only режим
