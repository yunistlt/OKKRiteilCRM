-- Формат записи статуса в истории — компактный, как писала синхронизация.
--
-- Расчёт зарплаты ищет код подстрокой: `new_value LIKE '%"code":"<код>"%'`.
-- Синк RetailCRM писал `{"code":"spam-zayavka"}` — без пробелов, и поиск
-- срабатывал. Перевод названий в JSON (миграция того же дня) собрал их через
-- jsonb_build_object, а он ставит пробел после двоеточия: `{"code": "..."}` —
-- и подстрока перестаёт совпадать.
--
-- Приводим все записи к компактному виду; значения экранируем через to_json,
-- чтобы кавычки и спецсимволы в названиях не ломали строку.

UPDATE public.order_history_log
   SET new_value = '{"code":' || to_json(new_value::jsonb->>'code')::text
                 || ',"name":' || to_json(new_value::jsonb->>'name')::text || '}'
 WHERE field = 'status'
   AND new_value LIKE '{"code": %'
   AND (new_value::jsonb->>'code') IS NOT NULL;

UPDATE public.order_history_log
   SET old_value = '{"code":' || to_json(old_value::jsonb->>'code')::text
                 || ',"name":' || to_json(old_value::jsonb->>'name')::text || '}'
 WHERE field = 'status'
   AND old_value LIKE '{"code": %'
   AND (old_value::jsonb->>'code') IS NOT NULL;
