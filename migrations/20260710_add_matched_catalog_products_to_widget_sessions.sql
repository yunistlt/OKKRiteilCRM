-- Найденные в каталоге ЗМК (marketing_products из проекта LVZCalc_bot) реальные позиции,
-- которые Елена сопоставила с запросом клиента: имя, реальная цена, ссылка, категория.
-- Используется для (1) заземления диалога и (2) передачи менеджеру реальной цены в лиде.
-- Клиенту цена не озвучивается — только для менеджера.
ALTER TABLE public.widget_sessions
    ADD COLUMN IF NOT EXISTS matched_catalog_products JSONB NOT NULL DEFAULT '[]'::jsonb;
