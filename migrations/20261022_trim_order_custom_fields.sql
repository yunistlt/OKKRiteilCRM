-- Доработка №33 (Евгения Матвеева, 22.10.2026): фильтр «Город доставки
-- (менеджерам ОП)» не находил заказ 900300 — в поле лежало « Первоуральск»
-- с ведущим пробелом, а фильтр ищет точное совпадение по GIN-индексу.
--
-- Причину правит код (crm режет крайние пробелы при сохранении, см.
-- lib/own-crm/own-orders.ts trimCustomFieldValues). Здесь — разовая чистка
-- уже записанных значений: на 22.10.2026 таких заказов 48.
UPDATE orders o
SET raw_payload = jsonb_set(
        o.raw_payload,
        '{customFields}',
        (
            SELECT jsonb_object_agg(
                f.k,
                CASE WHEN jsonb_typeof(o.raw_payload->'customFields'->f.k) = 'string'
                     THEN to_jsonb(btrim(f.v))
                     ELSE o.raw_payload->'customFields'->f.k
                END
            )
            FROM jsonb_each_text(o.raw_payload->'customFields') f(k, v)
        )
    )
WHERE jsonb_typeof(o.raw_payload->'customFields') = 'object'
  AND EXISTS (
      SELECT 1
      FROM jsonb_each_text(o.raw_payload->'customFields') f(k, v)
      WHERE jsonb_typeof(o.raw_payload->'customFields'->f.k) = 'string'
        AND f.v <> btrim(f.v)
  );
