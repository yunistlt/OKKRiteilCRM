-- Фильтр по любому полю карточки заказа (решение владельца 05.10.2026).
--
-- Поля лежат в raw_payload->'customFields', и поиск по ним шёл перебором всех
-- 30 000 заказов: запрос со счётчиком не укладывался в таймаут и список
-- возвращался пустым. GIN по этому объекту делает проверку «поле равно
-- значению» индексной.
CREATE INDEX IF NOT EXISTS orders_custom_fields_gin
    ON public.orders USING gin ((raw_payload -> 'customFields') jsonb_path_ops);
