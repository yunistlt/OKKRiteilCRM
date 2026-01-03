-- Статистика транскрибации звонков
-- Запустить через: psql или Supabase SQL Editor

-- 1. Общая статистика
SELECT 
    COUNT(*) FILTER (WHERE matches IS NOT NULL) as "Всего сматченных",
    COUNT(*) FILTER (WHERE transcript IS NOT NULL) as "Обработано",
    COUNT(*) FILTER (WHERE matches IS NOT NULL AND transcript IS NULL) as "В очереди",
    ROUND(
        COUNT(*) FILTER (WHERE transcript IS NOT NULL)::numeric / 
        NULLIF(COUNT(*) FILTER (WHERE matches IS NOT NULL), 0) * 100, 
        2
    ) as "Прогресс %"
FROM calls;

-- 2. Последний обработанный звонок
SELECT 
    id as "ID",
    timestamp as "Дата звонка",
    is_answering_machine as "Автоответчик?"
FROM calls
WHERE transcript IS NOT NULL
ORDER BY timestamp DESC
LIMIT 1;

-- 3. Последние 10 сматченных звонков (статус обработки)
SELECT 
    id as "ID",
    timestamp as "Дата",
    CASE 
        WHEN transcript IS NOT NULL THEN '✅ Готово'
        ELSE '⏳ Ожидает'
    END as "Статус"
FROM calls
WHERE matches IS NOT NULL
ORDER BY timestamp DESC
LIMIT 10;
