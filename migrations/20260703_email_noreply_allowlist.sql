-- Катерина: исключения из noreply-фильтра (источники лидов с адреса-робота).
-- Некоторые noreply-адреса — это НЕ спам, а реальные лиды: уведомления сайта-магазина
-- (webasyst: «Новый заказ», формы «Заказать звонок»). Такие письма нельзя отсекать до ИИ —
-- их нужно классифицировать и заводить заказ. Список адресов/доменов-исключений — в БД, правится в UI.
ALTER TABLE public.email_intake_config
    ADD COLUMN IF NOT EXISTS noreply_allowlist TEXT[] NOT NULL DEFAULT '{}';

-- Засев: сайт-магазин webasyst (заказы/формы приходят с noreply@webasyst.biz).
UPDATE public.email_intake_config
SET noreply_allowlist = ARRAY['webasyst.biz'], updated_at = now()
WHERE id = true AND (noreply_allowlist IS NULL OR array_length(noreply_allowlist, 1) IS NULL);
