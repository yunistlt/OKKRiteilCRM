-- Получатель платежа (наше юрлицо, на чей счёт пришли деньги) — отдельно от плательщика.
-- Аддитивно: новые nullable-колонки. У Точки в выписке имени получателя нет (останется NULL),
-- Т-Банк отдаёт его в raw_payload.receiver.
ALTER TABLE public.point_payments
    ADD COLUMN IF NOT EXISTS recipient_name text,
    ADD COLUMN IF NOT EXISTS recipient_inn  text;

-- Бэкофилл существующих строк Т-Банка из сырья.
UPDATE public.point_payments
   SET recipient_name = COALESCE(recipient_name, raw_payload->'receiver'->>'name'),
       recipient_inn  = COALESCE(recipient_inn,  raw_payload->'receiver'->>'inn')
 WHERE source = 'tbank'
   AND raw_payload ? 'receiver';
