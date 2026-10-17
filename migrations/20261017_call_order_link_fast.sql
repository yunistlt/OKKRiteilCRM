-- Представление «звонки заказа» перестаёт перебирать всю историю звонков.
--
-- ПОЧЕМУ. Вопрос «какие звонки у заказа 54607» стоил 1 878 мс: внутри представления
-- лежал CTE `razgovor` по всем 59 718 звонкам с разбором JSON в каждом, а
-- использовался он дважды — такой CTE Postgres обязан материализовать целиком, и
-- фильтр по заказу применялся уже к готовым 26 643 строкам. Замер 17.10.2026 на
-- боевой базе: 12 831 секунда времени базы за двое суток на 5 629 запросов. Это и
-- есть та нагрузка, из-за которой 16.10 дважды вставала работа отдела.
--
-- ЧТО СТАЛО. Тот же вопрос — 0,5 мс, потому что фильтр по заказу уходит в индекс
-- idx_call_matches_order_id, а строка звонка подбирается через LATERAL по индексу
-- idx_raw_telphin_call_id_upper.
--
-- ЧТО УБРАНО. Вторая половина UNION ALL — ветка через retailcrm_calls. Замер: она
-- даёт РОВНО 0 строк, все привязки из RetailCRM давно лежат в call_order_matches с
-- match_type='retailcrm'. От RetailCRM отвязались 09.10.2026, таблица не
-- пополняется, а перебирала ветка 33 036 строк на каждый запрос.
--
-- ЧТО ИЗМЕНИТСЯ В ДАННЫХ. 468 связей из 26 643 (1,8%) переедут на другой заказ.
-- Это не новая ошибка, а вскрытая старая: у 5 891 звонка несколько равноправных
-- привязок (by_phone_manager, by_partial_phone), и у 5 816 из них время привязки
-- совпадает до миллисекунды. Прежнее представление выбирало из равных ПРОИЗВОЛЬНО —
-- один и тот же звонок мог оказаться то у одного заказа, то у другого между двумя
-- запросами, а звонки питают баллы ОКК и через них разбор дня и распределение
-- заказов. Теперь из равных берётся привязка с меньшим match_id — записанная
-- первой. Выбор стал повторяемым; какой заказ верен по сути, решает матчинг, а не
-- это представление.

CREATE OR REPLACE VIEW public.call_order_link AS
SELECT z.telphin_call_id,
       -- Тип прежнего представления: номер заказа приходил из orders.id (bigint).
       -- Без приведения CREATE OR REPLACE откажется менять тип колонки.
       m.retailcrm_order_id::bigint AS order_id,
       z.started_at,
       z.duration_sec,
       z.direction,
       NULLIF(z.raw_payload ->> 'manager_id'::text, ''::text)::bigint AS manager_id,
       CASE
           WHEN m.match_type = ANY (ARRAY['okk_card'::text, 'manual'::text, 'okk_auto'::text]) THEN 'own'::text
           WHEN m.match_type = 'retailcrm'::text THEN 'crm'::text
           ELSE 'match'::text
       END AS source,
       m.match_type,
       m.explanation,
       (EXISTS (SELECT 1
                  FROM jsonb_array_elements(COALESCE(z.raw_payload -> 'cdr'::text, '[]'::jsonb)) c(value)
                 WHERE COALESCE((c.value ->> 'duration'::text)::integer, 0) > 0))
           OR z.recording_url IS NOT NULL AS answered
  FROM call_order_matches m
  -- Строка звонка: среди дублей по идентификатору берём самую содержательную —
  -- та же сортировка, что была в DISTINCT ON прежнего представления.
  CROSS JOIN LATERAL (
       SELECT t.telphin_call_id, t.started_at, t.duration_sec, t.direction, t.raw_payload, t.recording_url
         FROM raw_telphin_calls t
        WHERE upper(t.telphin_call_id) = upper(m.telphin_call_id)
        ORDER BY COALESCE(t.duration_sec, 0) DESC, (t.recording_url IS NOT NULL) DESC
        LIMIT 1
  ) z
 WHERE m.match_type <> 'ai_suggested'::text
   -- Одна привязка на звонок: у кого ранг выше, при равном ранге — свежая, при
   -- полном равенстве — записанная первой (повторяемость вместо жребия).
   AND NOT EXISTS (
       SELECT 1
         FROM call_order_matches better
        WHERE upper(better.telphin_call_id) = upper(m.telphin_call_id)
          AND better.match_type <> 'ai_suggested'::text
          AND (
               CASE better.match_type
                   WHEN 'okk_card'::text THEN 1
                   WHEN 'manual'::text THEN 2
                   WHEN 'okk_auto'::text THEN 3
                   WHEN 'retailcrm'::text THEN 4
                   ELSE 9
               END,
               (SELECT -extract(epoch FROM better.matched_at)),
               better.match_id
              ) < (
               CASE m.match_type
                   WHEN 'okk_card'::text THEN 1
                   WHEN 'manual'::text THEN 2
                   WHEN 'okk_auto'::text THEN 3
                   WHEN 'retailcrm'::text THEN 4
                   ELSE 9
               END,
               (SELECT -extract(epoch FROM m.matched_at)),
               m.match_id
              )
   );

COMMENT ON VIEW public.call_order_link IS
    'Звонки, привязанные к заказам: одна привязка на звонок, фильтр по order_id уходит в индекс.';
