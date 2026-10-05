-- Кто подписывает договор со стороны клиента (решение владельца 05.10.2026:
-- «нам нужны данные лиц, на которых будет составляться договор»).
--
-- Лена Парфёнова: «в карте клиента нет колонки для ФИО и должности
-- директора/генерального для договора».
--
-- Основание подписи нужно в самом договоре: «в лице генерального директора
-- Иванова И. И., действующего на основании Устава».
ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS signer_name text,
    ADD COLUMN IF NOT EXISTS signer_title text,
    ADD COLUMN IF NOT EXISTS signer_basis text;

COMMENT ON COLUMN public.clients.signer_name IS 'ФИО подписанта со стороны клиента (для договора)';
COMMENT ON COLUMN public.clients.signer_title IS 'Должность подписанта: генеральный директор, директор, ИП';
COMMENT ON COLUMN public.clients.signer_basis IS 'Основание: Устава, доверенности № … от …';
