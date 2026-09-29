-- Z-2: поля заказа RetailCRM переезжают из raw_payload в колонки таблицы orders.
-- Правило: структура RetailCRM один в один. Имена колонок — их коды, без перевода
-- и без snake_case, отсюда кавычки. Русское название каждого поля лежит рядом в
-- COMMENT — оттуда его берёт интерфейс, человеку латиницу не показываем.
--
-- Состав: стандартные поля заказа (карта в docs/own-crm/FIELDS.md, снята по
-- фактическим данным 30 878 заказов) + 65 своих полей из справочника
-- retailcrm_custom_fields. Восемь полей, которые встречаются в данных, но в
-- справочнике их нет, не берём — они отключены в RetailCRM (закон «только
-- активные сущности»).
--
-- Две особенности, вскрывшиеся при применении 28.09.2026:
--   1. Postgres режет имена длиннее 63 знаков. Поле
--      kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty
--      стало колонкой ...pole_dlia_dat. Единственное место, где имя не один в
--      один, и это ограничение Postgres, а не наше решение.
--   2. Колонка prichiny_otmeny в orders уже была — её создали раньше под
--      причину отмены. Оставили как есть, повторно не заводили.
--
-- Миграция только добавляет. raw_payload остаётся полной копией ответа RetailCRM.
-- Старые колонки (number, status, totalsumm, phone, site, manager_id) не трогаем.

ALTER TABLE public.orders
    -- строки
    ADD COLUMN IF NOT EXISTS "orderType" TEXT,
    ADD COLUMN IF NOT EXISTS "orderMethod" TEXT,
    ADD COLUMN IF NOT EXISTS "countryIso" TEXT,
    ADD COLUMN IF NOT EXISTS "currency" TEXT,
    ADD COLUMN IF NOT EXISTS "privilegeType" TEXT,
    ADD COLUMN IF NOT EXISTS "managerComment" TEXT,
    ADD COLUMN IF NOT EXISTS "statusComment" TEXT,
    ADD COLUMN IF NOT EXISTS "customerComment" TEXT,
    ADD COLUMN IF NOT EXISTS "firstName" TEXT,
    ADD COLUMN IF NOT EXISTS "lastName" TEXT,
    ADD COLUMN IF NOT EXISTS "patronymic" TEXT,
    ADD COLUMN IF NOT EXISTS "email" TEXT,
    ADD COLUMN IF NOT EXISTS "additionalPhone" TEXT,
    ADD COLUMN IF NOT EXISTS "shipmentStore" TEXT,
    ADD COLUMN IF NOT EXISTS "externalId" TEXT,
    -- даты
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "markDatetime" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "fullPaidAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "shipmentDate" DATE,
    -- числа
    ADD COLUMN IF NOT EXISTS "slug" BIGINT,
    ADD COLUMN IF NOT EXISTS "summ" NUMERIC,
    ADD COLUMN IF NOT EXISTS "prepaySum" NUMERIC,
    ADD COLUMN IF NOT EXISTS "purchaseSumm" NUMERIC,
    ADD COLUMN IF NOT EXISTS "bonusesChargeTotal" NUMERIC,
    ADD COLUMN IF NOT EXISTS "bonusesCreditTotal" NUMERIC,
    ADD COLUMN IF NOT EXISTS "personalDiscountPercent" NUMERIC,
    ADD COLUMN IF NOT EXISTS "weight" NUMERIC,
    ADD COLUMN IF NOT EXISTS "width" NUMERIC,
    ADD COLUMN IF NOT EXISTS "height" NUMERIC,
    ADD COLUMN IF NOT EXISTS "length" NUMERIC,
    -- да/нет
    ADD COLUMN IF NOT EXISTS "call" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "expired" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "fromApi" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "shipped" BOOLEAN,
    -- вложенные объекты целиком: разбираем отдельными шагами (Z-3, K-1)
    ADD COLUMN IF NOT EXISTS "delivery" JSONB,
    ADD COLUMN IF NOT EXISTS "contragent" JSONB,
    ADD COLUMN IF NOT EXISTS "contact" JSONB,
    ADD COLUMN IF NOT EXISTS "company" JSONB,
    ADD COLUMN IF NOT EXISTS "source" JSONB,
    ADD COLUMN IF NOT EXISTS "loyaltyLevel" JSONB,
    ADD COLUMN IF NOT EXISTS "links" JSONB,
    -- свои поля заказа из справочника RetailCRM (65 штук)
    ADD COLUMN IF NOT EXISTS "adres_fakt" TEXT,
    ADD COLUMN IF NOT EXISTS "artikuly_tovarov_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "blank_raznoglasi" TEXT,
    ADD COLUMN IF NOT EXISTS "blank_raznoglasi_zamechania" TEXT,
    ADD COLUMN IF NOT EXISTS "change_name_manager" TEXT,
    ADD COLUMN IF NOT EXISTS "chasovoi_poias" TEXT,
    ADD COLUMN IF NOT EXISTS "consignee" TEXT,
    ADD COLUMN IF NOT EXISTS "control" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "data_kontakta" DATE,
    ADD COLUMN IF NOT EXISTS "data_nomer_doverenosti" TEXT,
    ADD COLUMN IF NOT EXISTS "data_otmeny_zakaza" DATE,
    ADD COLUMN IF NOT EXISTS "data_peredachi_zakaza_v_proizvodstvo" DATE,
    ADD COLUMN IF NOT EXISTS "data_pervoj_oplaty_po_zakazu" DATE,
    ADD COLUMN IF NOT EXISTS "datacheta" DATE,
    ADD COLUMN IF NOT EXISTS "date_upd" DATE,
    ADD COLUMN IF NOT EXISTS "dlia_kp_mufelnye_pechi_privetstvennyi_slaid1" TEXT,
    ADD COLUMN IF NOT EXISTS "dlia_kp_mufelnye_pechi_tekh_kharakteristiki" TEXT,
    ADD COLUMN IF NOT EXISTS "dokumentooborot_cherez_edo" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "dolzhnost" TEXT,
    ADD COLUMN IF NOT EXISTS "dop_telefon2" TEXT,
    ADD COLUMN IF NOT EXISTS "dop_telefon3" TEXT,
    ADD COLUMN IF NOT EXISTS "fio" TEXT,
    ADD COLUMN IF NOT EXISTS "gorod_dostavki_menedzheram_op" TEXT,
    ADD COLUMN IF NOT EXISTS "inzhener_zakaza" TEXT,
    ADD COLUMN IF NOT EXISTS "kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty" DATE,
    ADD COLUMN IF NOT EXISTS "kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo" TEXT,
    ADD COLUMN IF NOT EXISTS "komentarii" TEXT,
    ADD COLUMN IF NOT EXISTS "komment_diveleri" TEXT,
    ADD COLUMN IF NOT EXISTS "kommentarii_proizvodstvu_logistu_snabzheniiu" TEXT,
    ADD COLUMN IF NOT EXISTS "lpr" TEXT,
    ADD COLUMN IF NOT EXISTS "marka_avto_dlia_otobrazheniia_v_zagolovke_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "marksend" TEXT,
    ADD COLUMN IF NOT EXISTS "marzha" TEXT,
    ADD COLUMN IF NOT EXISTS "osnovanie_podpisi" TEXT,
    ADD COLUMN IF NOT EXISTS "partnerstvo" TEXT,
    ADD COLUMN IF NOT EXISTS "platnoe_khranenie" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "poshta" TEXT,
    ADD COLUMN IF NOT EXISTS "position" TEXT,
    ADD COLUMN IF NOT EXISTS "prichiny_otmeny" TEXT,
    ADD COLUMN IF NOT EXISTS "primecanie_po_otgruzke" TEXT,
    ADD COLUMN IF NOT EXISTS "prioriry_number" INTEGER,
    ADD COLUMN IF NOT EXISTS "roistat" TEXT,
    ADD COLUMN IF NOT EXISTS "rs_metrika_client_id" TEXT,
    ADD COLUMN IF NOT EXISTS "schiot_deistvitelen_v_techenie_dnei" TEXT,
    ADD COLUMN IF NOT EXISTS "sebestoimost2" NUMERIC,
    ADD COLUMN IF NOT EXISTS "sfera_deiatelnosti" TEXT,
    ADD COLUMN IF NOT EXISTS "srok_izgot" INTEGER,
    ADD COLUMN IF NOT EXISTS "ssylka_na_dop_tovar1_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "ssylka_na_dop_tovar2_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "ssylka_na_dop_tovar3_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "ssylka_na_kartinku1_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "ssylka_na_kartinku2_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "ssylka_na_kartinku3_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "ssylka_na_kartinku4_dlya_otobrazheniya_v_kp" TEXT,
    ADD COLUMN IF NOT EXISTS "start_send" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "tip_klienta_pole_dlia_klienta1" TEXT,
    ADD COLUMN IF NOT EXISTS "top3_prokhodim_li_po_tsene2" TEXT,
    ADD COLUMN IF NOT EXISTS "top3_prokhodim_po_srokam1" TEXT,
    ADD COLUMN IF NOT EXISTS "top3_prokhodim_po_tekh_kharakteristikam" TEXT,
    ADD COLUMN IF NOT EXISTS "typ_castomer" TEXT,
    ADD COLUMN IF NOT EXISTS "typ_customer_margin" TEXT,
    ADD COLUMN IF NOT EXISTS "vy_dlya_sebya_ili_dlya_zakazchika_priobretaete" TEXT,
    ADD COLUMN IF NOT EXISTS "warehouse_address" TEXT,
    ADD COLUMN IF NOT EXISTS "warehouse_email" TEXT,
    ADD COLUMN IF NOT EXISTS "warehouse_phone" TEXT;

COMMENT ON COLUMN public.orders."adres_fakt" IS 'Адрес фактический';
COMMENT ON COLUMN public.orders."artikuly_tovarov_dlya_otobrazheniya_v_kp" IS 'Артикулы ДОП товаров для отображения в КП (через запятую без пробелов)';
COMMENT ON COLUMN public.orders."blank_raznoglasi" IS 'Пункты договора к бланку разногласий';
COMMENT ON COLUMN public.orders."blank_raznoglasi_zamechania" IS 'Пункты замечаний к бланку разногласий';
COMMENT ON COLUMN public.orders."change_name_manager" IS 'Данные менеджера для тригера';
COMMENT ON COLUMN public.orders."chasovoi_poias" IS 'Часовой пояс';
COMMENT ON COLUMN public.orders."consignee" IS 'Наименование грузополучателя';
COMMENT ON COLUMN public.orders."control" IS 'КОНТРОЛЬ';
COMMENT ON COLUMN public.orders."data_kontakta" IS 'Дата следующего контакта';
COMMENT ON COLUMN public.orders."data_nomer_doverenosti" IS 'Номер и дата доверенности';
COMMENT ON COLUMN public.orders."data_otmeny_zakaza" IS 'Дата ОТМЕНЫ заказа';
COMMENT ON COLUMN public.orders."data_peredachi_zakaza_v_proizvodstvo" IS 'Дата Передачи заказа в производство';
COMMENT ON COLUMN public.orders."data_pervoj_oplaty_po_zakazu" IS 'Дата самой первой оплаты по заказу (неважно частичной или полной)';
COMMENT ON COLUMN public.orders."datacheta" IS 'Датасчет';
COMMENT ON COLUMN public.orders."date_upd" IS 'Дата составления отгрузочных документов';
COMMENT ON COLUMN public.orders."dlia_kp_mufelnye_pechi_privetstvennyi_slaid1" IS 'Для КП Муфельные печи - Приветственный слайд';
COMMENT ON COLUMN public.orders."dlia_kp_mufelnye_pechi_tekh_kharakteristiki" IS 'Для КП Муфельные печи - Тех. характеристики';
COMMENT ON COLUMN public.orders."dokumentooborot_cherez_edo" IS 'Документооборот через ЭДО';
COMMENT ON COLUMN public.orders."dolzhnost" IS 'Должность';
COMMENT ON COLUMN public.orders."dop_telefon2" IS 'Доп. телефон (2)';
COMMENT ON COLUMN public.orders."dop_telefon3" IS 'Доп. телефон (3)';
COMMENT ON COLUMN public.orders."fio" IS 'Должность подписывающего договор в ИМЕНИТЕЛЬНОМ ПАДЕЖЕ';
COMMENT ON COLUMN public.orders."gorod_dostavki_menedzheram_op" IS 'Город доставки (менеджерам ОП)';
COMMENT ON COLUMN public.orders."inzhener_zakaza" IS 'Инженер заказа';
COMMENT ON COLUMN public.orders."kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty" IS 'В каком месяце планируете закупку?';
COMMENT ON COLUMN public.orders."kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo" IS 'Когда вам нужно чтобы оборудование уже стояло?';
COMMENT ON COLUMN public.orders."komentarii" IS 'Комментарий контролера';
COMMENT ON COLUMN public.orders."komment_diveleri" IS 'Комментарий логиста';
COMMENT ON COLUMN public.orders."kommentarii_proizvodstvu_logistu_snabzheniiu" IS 'Комментарий производству/логисту/снабжению';
COMMENT ON COLUMN public.orders."lpr" IS 'ФИО подписывающего договор В РОДИТЕЛЬНОМ ПАДЕЖЕ';
COMMENT ON COLUMN public.orders."marka_avto_dlia_otobrazheniia_v_zagolovke_kp" IS 'Марка авто для отображения в заголовке КП';
COMMENT ON COLUMN public.orders."marksend" IS 'Маркер рассылки';
COMMENT ON COLUMN public.orders."marzha" IS 'Маржа';
COMMENT ON COLUMN public.orders."osnovanie_podpisi" IS 'На основание чего имеет право подписи';
COMMENT ON COLUMN public.orders."partnerstvo" IS 'Партнерство';
COMMENT ON COLUMN public.orders."platnoe_khranenie" IS 'Платное хранение';
COMMENT ON COLUMN public.orders."poshta" IS 'Дополнительный Email';
COMMENT ON COLUMN public.orders."position" IS 'Должность подписывающего договор в РОДИТЕЛЬНОМ ПАДЕЖЕ';
COMMENT ON COLUMN public.orders."prichiny_otmeny" IS 'Причины Отмены';
COMMENT ON COLUMN public.orders."primecanie_po_otgruzke" IS 'Примечание по отгрузке';
COMMENT ON COLUMN public.orders."prioriry_number" IS 'Приоритет';
COMMENT ON COLUMN public.orders."roistat" IS 'roistat';
COMMENT ON COLUMN public.orders."rs_metrika_client_id" IS 'rs_metrika_client_id';
COMMENT ON COLUMN public.orders."schiot_deistvitelen_v_techenie_dnei" IS 'Счёт действителен в течение (дней)*';
COMMENT ON COLUMN public.orders."sebestoimost2" IS 'Себестоимость';
COMMENT ON COLUMN public.orders."sfera_deiatelnosti" IS 'Сфера деятельности*';
COMMENT ON COLUMN public.orders."srok_izgot" IS 'Срок изготовления в днях*';
COMMENT ON COLUMN public.orders."ssylka_na_dop_tovar1_dlya_otobrazheniya_v_kp" IS 'Текст и/или Ссылка на ДОП товар (1) для отображения в КП';
COMMENT ON COLUMN public.orders."ssylka_na_dop_tovar2_dlya_otobrazheniya_v_kp" IS 'Текст и/или Ссылка на ДОП товар (2) для отображения в КП';
COMMENT ON COLUMN public.orders."ssylka_na_dop_tovar3_dlya_otobrazheniya_v_kp" IS 'Текст и/или Ссылка на ДОП товар (3) для отображения в КП';
COMMENT ON COLUMN public.orders."ssylka_na_kartinku1_dlya_otobrazheniya_v_kp" IS 'Картинка Габарит схемы (1) для отображения в КП (вставьте ТОЛЬКО ССЫЛКУ на картинку)';
COMMENT ON COLUMN public.orders."ssylka_na_kartinku2_dlya_otobrazheniya_v_kp" IS 'Картинка Габарит схемы (2) для отображения в КП (вставьте ТОЛЬКО ССЫЛКУ на картинку)';
COMMENT ON COLUMN public.orders."ssylka_na_kartinku3_dlya_otobrazheniya_v_kp" IS 'Картинка 3D модели (3) для отображения в КП (вставьте ТОЛЬКО ССЫЛКУ на картинку)';
COMMENT ON COLUMN public.orders."ssylka_na_kartinku4_dlya_otobrazheniya_v_kp" IS 'Картинка 3D модели (4) для отображения в КП (вставьте ТОЛЬКО ССЫЛКУ на картинку)';
COMMENT ON COLUMN public.orders."start_send" IS 'запуск рассылки по тригеры';
COMMENT ON COLUMN public.orders."tip_klienta_pole_dlia_klienta1" IS 'Сегмент клиента';
COMMENT ON COLUMN public.orders."top3_prokhodim_li_po_tsene2" IS 'ТОП3 Проходим ли по цене?';
COMMENT ON COLUMN public.orders."top3_prokhodim_po_srokam1" IS 'ТОП3 Проходим по срокам?';
COMMENT ON COLUMN public.orders."top3_prokhodim_po_tekh_kharakteristikam" IS 'ТОП3 Проходим по тех. характеристикам?';
COMMENT ON COLUMN public.orders."typ_castomer" IS 'Категория товара*';
COMMENT ON COLUMN public.orders."typ_customer_margin" IS 'Форма закупки*';
COMMENT ON COLUMN public.orders."vy_dlya_sebya_ili_dlya_zakazchika_priobretaete" IS 'Вы для себя или для заказчика приобретаете?';
COMMENT ON COLUMN public.orders."warehouse_address" IS 'Адрес Склада';
COMMENT ON COLUMN public.orders."warehouse_email" IS 'Email Склада';
COMMENT ON COLUMN public.orders."warehouse_phone" IS 'Телефон Склада';

-- Частые вопросы: ИНН контрагента (есть у 36% заказов), дата создания,
-- дата следующего контакта и приоритет — по ним фильтруют менеджеры и боты.
CREATE INDEX IF NOT EXISTS idx_orders_contragent_inn ON public.orders ((("contragent"->>'INN')));
CREATE INDEX IF NOT EXISTS idx_orders_created_at_crm ON public.orders ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_orders_data_kontakta ON public.orders ("data_kontakta");
CREATE INDEX IF NOT EXISTS idx_orders_prioriry_number ON public.orders ("prioriry_number");

COMMENT ON COLUMN public.orders."managerComment" IS 'Комментарий менеджера';
COMMENT ON COLUMN public.orders."customerComment" IS 'Комментарий клиента';
COMMENT ON COLUMN public.orders."statusComment" IS 'Комментарий к статусу';
COMMENT ON COLUMN public.orders."contragent" IS 'Контрагент: ИНН, КПП, банк, юридический адрес';
COMMENT ON COLUMN public.orders."delivery" IS 'Доставка: адрес, стоимость, служба';
COMMENT ON COLUMN public.orders."company" IS 'Юрлицо покупателя из карточки клиента';
