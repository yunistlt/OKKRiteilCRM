-- Покупатель заказа отдельной колонкой.
--
-- Из объектов верхнего уровня RetailCRM только customer оставался в JSON: его
-- просили боты РОПа (id клиента и его название). Весит 30 МБ на 347 МБ таблицы
-- — берём, как и остальные, один в один.
--
-- Миграция добавляет колонку и переопределяет триггер: в нём появилась одна
-- строка про customer, остальное без изменений.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "customer" JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders ((("customer"->>'id')));
COMMENT ON COLUMN public.orders."customer" IS 'Покупатель заказа: id, название, счётчики покупок';

CREATE OR REPLACE FUNCTION public.orders_fill_retailcrm_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    p JSONB := NEW.raw_payload;
    c JSONB;
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
        RETURN NEW;
    END IF;
    c := CASE WHEN jsonb_typeof(p->'customFields') = 'object'
              THEN p->'customFields' ELSE '{}'::jsonb END;

    NEW."orderType" := nullif(p->>'orderType','');
    NEW."orderMethod" := nullif(p->>'orderMethod','');
    NEW."countryIso" := nullif(p->>'countryIso','');
    NEW."currency" := nullif(p->>'currency','');
    NEW."privilegeType" := nullif(p->>'privilegeType','');
    NEW."managerComment" := nullif(p->>'managerComment','');
    NEW."statusComment" := nullif(p->>'statusComment','');
    NEW."customerComment" := nullif(p->>'customerComment','');
    NEW."firstName" := nullif(p->>'firstName','');
    NEW."lastName" := nullif(p->>'lastName','');
    NEW."patronymic" := nullif(p->>'patronymic','');
    NEW."email" := nullif(p->>'email','');
    NEW."additionalPhone" := nullif(p->>'additionalPhone','');
    NEW."shipmentStore" := nullif(p->>'shipmentStore','');
    NEW."externalId" := nullif(p->>'externalId','');
    NEW."createdAt" := nullif(p->>'createdAt','')::timestamptz;
    NEW."statusUpdatedAt" := nullif(p->>'statusUpdatedAt','')::timestamptz;
    NEW."markDatetime" := nullif(p->>'markDatetime','')::timestamptz;
    NEW."fullPaidAt" := nullif(p->>'fullPaidAt','')::timestamptz;
    NEW."shipmentDate" := nullif(p->>'shipmentDate','')::date;
    NEW."slug" := nullif(p->>'slug','')::bigint;
    NEW."summ" := nullif(p->>'summ','')::numeric;
    NEW."prepaySum" := nullif(p->>'prepaySum','')::numeric;
    NEW."purchaseSumm" := nullif(p->>'purchaseSumm','')::numeric;
    NEW."bonusesChargeTotal" := nullif(p->>'bonusesChargeTotal','')::numeric;
    NEW."bonusesCreditTotal" := nullif(p->>'bonusesCreditTotal','')::numeric;
    NEW."personalDiscountPercent" := nullif(p->>'personalDiscountPercent','')::numeric;
    NEW."weight" := nullif(p->>'weight','')::numeric;
    NEW."width" := nullif(p->>'width','')::numeric;
    NEW."height" := nullif(p->>'height','')::numeric;
    NEW."length" := nullif(p->>'length','')::numeric;
    NEW."call" := nullif(p->>'call','')::boolean;
    NEW."expired" := nullif(p->>'expired','')::boolean;
    NEW."fromApi" := nullif(p->>'fromApi','')::boolean;
    NEW."shipped" := nullif(p->>'shipped','')::boolean;
    NEW."customer" := p->'customer';
    NEW."delivery" := p->'delivery';
    NEW."contragent" := p->'contragent';
    NEW."contact" := p->'contact';
    NEW."company" := p->'company';
    NEW."source" := p->'source';
    NEW."loyaltyLevel" := p->'loyaltyLevel';
    NEW."links" := p->'links';
    NEW."adres_fakt" := nullif(c->>'adres_fakt','');
    NEW."artikuly_tovarov_dlya_otobrazheniya_v_kp" := nullif(c->>'artikuly_tovarov_dlya_otobrazheniya_v_kp','');
    NEW."blank_raznoglasi" := nullif(c->>'blank_raznoglasi','');
    NEW."blank_raznoglasi_zamechania" := nullif(c->>'blank_raznoglasi_zamechania','');
    NEW."change_name_manager" := nullif(c->>'change_name_manager','');
    NEW."chasovoi_poias" := nullif(c->>'chasovoi_poias','');
    NEW."consignee" := nullif(c->>'consignee','');
    NEW."control" := CASE WHEN c->>'control' IN ('true','false','1','0') THEN (c->>'control' IN ('true','1')) END;
    NEW."data_kontakta" := CASE WHEN c->>'data_kontakta' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'data_kontakta',10)::date END;
    NEW."data_nomer_doverenosti" := nullif(c->>'data_nomer_doverenosti','');
    NEW."data_otmeny_zakaza" := CASE WHEN c->>'data_otmeny_zakaza' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'data_otmeny_zakaza',10)::date END;
    NEW."data_peredachi_zakaza_v_proizvodstvo" := CASE WHEN c->>'data_peredachi_zakaza_v_proizvodstvo' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'data_peredachi_zakaza_v_proizvodstvo',10)::date END;
    NEW."data_pervoj_oplaty_po_zakazu" := CASE WHEN c->>'data_pervoj_oplaty_po_zakazu' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'data_pervoj_oplaty_po_zakazu',10)::date END;
    NEW."datacheta" := CASE WHEN c->>'datacheta' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'datacheta',10)::date END;
    NEW."date_upd" := CASE WHEN c->>'date_upd' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'date_upd',10)::date END;
    NEW."dlia_kp_mufelnye_pechi_privetstvennyi_slaid1" := nullif(c->>'dlia_kp_mufelnye_pechi_privetstvennyi_slaid1','');
    NEW."dlia_kp_mufelnye_pechi_tekh_kharakteristiki" := nullif(c->>'dlia_kp_mufelnye_pechi_tekh_kharakteristiki','');
    NEW."dokumentooborot_cherez_edo" := CASE WHEN c->>'dokumentooborot_cherez_edo' IN ('true','false','1','0') THEN (c->>'dokumentooborot_cherez_edo' IN ('true','1')) END;
    NEW."dolzhnost" := nullif(c->>'dolzhnost','');
    NEW."dop_telefon2" := nullif(c->>'dop_telefon2','');
    NEW."dop_telefon3" := nullif(c->>'dop_telefon3','');
    NEW."fio" := nullif(c->>'fio','');
    NEW."gorod_dostavki_menedzheram_op" := nullif(c->>'gorod_dostavki_menedzheram_op','');
    NEW."inzhener_zakaza" := nullif(c->>'inzhener_zakaza','');
    NEW."kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_dat" := CASE WHEN c->>'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty',10)::date END;
    NEW."kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo" := nullif(c->>'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo','');
    NEW."komentarii" := nullif(c->>'komentarii','');
    NEW."komment_diveleri" := nullif(c->>'komment_diveleri','');
    NEW."kommentarii_proizvodstvu_logistu_snabzheniiu" := nullif(c->>'kommentarii_proizvodstvu_logistu_snabzheniiu','');
    NEW."lpr" := nullif(c->>'lpr','');
    NEW."marka_avto_dlia_otobrazheniia_v_zagolovke_kp" := nullif(c->>'marka_avto_dlia_otobrazheniia_v_zagolovke_kp','');
    NEW."marksend" := nullif(c->>'marksend','');
    NEW."marzha" := nullif(c->>'marzha','');
    NEW."osnovanie_podpisi" := nullif(c->>'osnovanie_podpisi','');
    NEW."partnerstvo" := nullif(c->>'partnerstvo','');
    NEW."platnoe_khranenie" := CASE WHEN c->>'platnoe_khranenie' IN ('true','false','1','0') THEN (c->>'platnoe_khranenie' IN ('true','1')) END;
    NEW."poshta" := nullif(c->>'poshta','');
    NEW."position" := nullif(c->>'position','');
    NEW."primecanie_po_otgruzke" := nullif(c->>'primecanie_po_otgruzke','');
    NEW."prioriry_number" := CASE WHEN c->>'prioriry_number' ~ '^-?[0-9]+$' THEN (c->>'prioriry_number')::integer END;
    NEW."roistat" := nullif(c->>'roistat','');
    NEW."rs_metrika_client_id" := nullif(c->>'rs_metrika_client_id','');
    NEW."schiot_deistvitelen_v_techenie_dnei" := nullif(c->>'schiot_deistvitelen_v_techenie_dnei','');
    NEW."sebestoimost2" := CASE WHEN c->>'sebestoimost2' ~ '^-?[0-9]+([.,][0-9]+)?$' THEN replace(c->>'sebestoimost2',',','.')::numeric END;
    NEW."sfera_deiatelnosti" := nullif(c->>'sfera_deiatelnosti','');
    NEW."srok_izgot" := CASE WHEN c->>'srok_izgot' ~ '^-?[0-9]+$' THEN (c->>'srok_izgot')::integer END;
    NEW."ssylka_na_dop_tovar1_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_dop_tovar1_dlya_otobrazheniya_v_kp','');
    NEW."ssylka_na_dop_tovar2_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_dop_tovar2_dlya_otobrazheniya_v_kp','');
    NEW."ssylka_na_dop_tovar3_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_dop_tovar3_dlya_otobrazheniya_v_kp','');
    NEW."ssylka_na_kartinku1_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_kartinku1_dlya_otobrazheniya_v_kp','');
    NEW."ssylka_na_kartinku2_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_kartinku2_dlya_otobrazheniya_v_kp','');
    NEW."ssylka_na_kartinku3_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_kartinku3_dlya_otobrazheniya_v_kp','');
    NEW."ssylka_na_kartinku4_dlya_otobrazheniya_v_kp" := nullif(c->>'ssylka_na_kartinku4_dlya_otobrazheniya_v_kp','');
    NEW."start_send" := CASE WHEN c->>'start_send' IN ('true','false','1','0') THEN (c->>'start_send' IN ('true','1')) END;
    NEW."tip_klienta_pole_dlia_klienta1" := nullif(c->>'tip_klienta_pole_dlia_klienta1','');
    NEW."top3_prokhodim_li_po_tsene2" := nullif(c->>'top3_prokhodim_li_po_tsene2','');
    NEW."top3_prokhodim_po_srokam1" := nullif(c->>'top3_prokhodim_po_srokam1','');
    NEW."top3_prokhodim_po_tekh_kharakteristikam" := nullif(c->>'top3_prokhodim_po_tekh_kharakteristikam','');
    NEW."typ_castomer" := nullif(c->>'typ_castomer','');
    NEW."typ_customer_margin" := nullif(c->>'typ_customer_margin','');
    NEW."vy_dlya_sebya_ili_dlya_zakazchika_priobretaete" := nullif(c->>'vy_dlya_sebya_ili_dlya_zakazchika_priobretaete','');
    NEW."warehouse_address" := nullif(c->>'warehouse_address','');
    NEW."warehouse_email" := nullif(c->>'warehouse_email','');
    NEW."warehouse_phone" := nullif(c->>'warehouse_phone','');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Заказ важнее колонок: если разбор споткнулся, сохраняем строку как есть.
    RAISE WARNING 'orders_fill_retailcrm_columns: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_fill_retailcrm_columns ON public.orders;
CREATE TRIGGER orders_fill_retailcrm_columns
    BEFORE INSERT OR UPDATE OF raw_payload ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.orders_fill_retailcrm_columns();

COMMENT ON FUNCTION public.orders_fill_retailcrm_columns() IS
  'Перекладывает поля заказа из raw_payload в колонки при записи (Z-5)';
