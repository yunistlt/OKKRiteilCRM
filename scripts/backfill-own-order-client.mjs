/**
 * Разовая починка своих заказов: связать с карточкой клиента и дописать
 * телефоны в карточку.
 *
 * Причина: `insertOwnOrder` писал клиента только внутрь `raw_payload`, а
 * колонку `orders.customer` — по которой читается карточка заказа, фильтр по
 * клиенту и сверка номеров — не заполнял. Карточки заводились, телефон в них
 * попадал, но заказ с карточкой связан не был (разбор 08.10.2026). Код
 * исправлен; здесь лечим уже заведённые заказы.
 *
 * Запуск: node scripts/backfill-own-order-client.mjs
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
const url = process.env.DATABASE_URL
    || /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^"|"$/g, '');
const sql = postgres(url, { ssl: 'require', max: 1 });

const linked = await sql`
  UPDATE public.orders o
     SET customer = o.raw_payload->'customer'
   WHERE o.id >= 900000000
     AND coalesce(o.customer->>'id','') !~ '^[0-9]+$'
     AND o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
  RETURNING o.number`;
console.log('заказов связано с карточкой:', linked.length);

const left = await sql`
  SELECT count(*)::int AS n FROM public.orders
   WHERE id >= 900000000 AND coalesce(customer->>'id','') !~ '^[0-9]+$'`;
console.log('осталось без карточки:', left[0].n);

const added = await sql`
  WITH op AS (
    SELECT (o.customer->>'id')::bigint AS client_id,
           right(regexp_replace(p, '\D', '', 'g'), 10) AS tail,
           min(p) AS phone
      FROM public.orders o,
           LATERAL unnest(ARRAY[o.phone, o."additionalPhone"]) AS p
     WHERE o.id >= 900000000 AND o.crm_deleted_at IS NULL
       AND o.customer->>'id' ~ '^[0-9]+$'
       AND length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 10
     GROUP BY 1, 2
  ), missing AS (
    SELECT op.client_id, op.phone
      FROM op JOIN public.clients c ON c.id = op.client_id
     WHERE NOT EXISTS (
       SELECT 1 FROM unnest(coalesce(c.phones, ARRAY[]::text[])) q
        WHERE right(regexp_replace(q, '\D', '', 'g'), 10) = op.tail)
  ), grouped AS (
    SELECT client_id, array_agg(DISTINCT phone) AS phones FROM missing GROUP BY 1
  )
  UPDATE public.clients c
     SET phones = coalesce(c.phones, ARRAY[]::text[]) || g.phones,
         updated_at = now()
    FROM grouped g
   WHERE c.id = g.client_id
  RETURNING c.id`;
console.log('карточек дополнено телефонами:', added.length);

await sql.end();
