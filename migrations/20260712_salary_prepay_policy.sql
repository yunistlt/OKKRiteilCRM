-- Политика «% предоплаты» для дашборда менеджера (личный кабинет ЗП).
-- Ноль хардкода: порог и коды «оплаченных» статусов платежа — в конфиге, версионируются по дате.
-- Ключ ОТДЕЛЬНЫЙ от обязательного набора SALARY_CONFIG_SCHEMAS (getResolvedConfig),
-- читается собственным мягким геттером getPrepayPolicy() — его отсутствие НЕ ломает расчёт ЗП.
--
-- threshold_pct   — норма среднего % предоплаты (ниже = премия под риском). Задано бизнесом = 70.
-- paid_statuses   — коды статусов платежа RetailCRM, считающихся фактической оплатой
--                   (payments[*].status). По факту данных: 'paid' (оплачен), 'check-off-full'
--                   (полное списание/зачёт). Счета со status=null — выставлены, но не оплачены.
-- invoice_types   — типы payments[*].type = ВЫСТАВЛЕННЫЙ СЧЁТ (не фактический приход денег).
--                   Банк-синхронизация пушит bank-transfer на ту же сумму, что и invoicejur —
--                   задвоение. Фактический приход = реальные поступления (не-invoice типы),
--                   invoice — только фолбэк, если прихода в заказе нет (заказы до банк-синка).
INSERT INTO salary_config (key, value, effective_from, note, created_by)
VALUES (
  'prepay_policy',
  '{"threshold_pct": 70, "paid_statuses": ["paid", "check-off-full"], "invoice_types": ["invoicejur", "invoicefiz"]}'::jsonb,
  '2020-01-01',
  'Порог % предоплаты, оплаченные статусы и типы счетов (дашборд менеджера)',
  'migration'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;
