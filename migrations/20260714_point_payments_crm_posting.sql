-- Состояние ПРОВОДКИ платежа в RetailCRM — отдельно от ФАКТА поступления денег.
-- Факт прихода (source/amount/purpose/payer/raw_payload) неизменен и никогда не мутируется.
-- Проводка же — изменяемое: её могут провести мы (авто) или менеджер (вручную), удалить, переделать.
--
-- crm_posting:
--   'posted_auto'   — проведено нами (наш externalId tochka-/tbank- есть на заказе);
--   'posted_manual' — проведено менеджером вручную (нашего externalId нет, но на заказе есть
--                     оплата на ту же сумму) — БД не врёт, что «наш платёж на месте»;
--   'not_posted'    — на заказе нет ни нашей, ни ручной оплаты на эту сумму;
--   NULL            — не применимо (не сматчен на заказ / чужой проект / ignored).
-- posting_checked_at — когда последний раз сверяли проводку с RetailCRM (для периодической сверки).
-- Аддитивно, обратно совместимо.
ALTER TABLE public.point_payments
    ADD COLUMN IF NOT EXISTS crm_posting text,
    ADD COLUMN IF NOT EXISTS posting_checked_at timestamptz;
