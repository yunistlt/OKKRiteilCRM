-- ============================================================
-- ОКК-Таблица v2: полный набор колонок из Google Spreadsheet
-- "Чек-лист менеджеры ОП" (48 колонок)
--
-- Группы колонок точно как в таблице:
--   Общая информация
--   Статус и время ожидания лида
--   Заполнение полей и ведение
--   Оценка разговоров
--   Установление контакта (скрипт)
--   Выявление потребностей (скрипт)
--   Работа с возражениями (скрипт)
--   В конце диалога (скрипт)
--   Ведение диалога (скрипт)
--   Итоговые оценки
-- ============================================================

-- Удаляем старую таблицу и создаём заново с полным набором колонок
DROP TABLE IF EXISTS public.okk_order_scores;

CREATE TABLE public.okk_order_scores (
    id                              BIGSERIAL PRIMARY KEY,

    -- ─────────────────────────────────────────────
    -- ОБЩАЯ ИНФОРМАЦИЯ (col A-F)
    -- ─────────────────────────────────────────────
    order_id                        BIGINT NOT NULL,        -- C: Ссылка на сделку
    manager_id                      BIGINT,
    mop_name                        TEXT,                   -- A: МОП
    eval_date                       TIMESTAMPTZ DEFAULT now(), -- B: Дата и время оценки
    order_status                    TEXT,                   -- F: Статус лида/сделки
    marker_kontrol                  BOOLEAN,                -- E: Маркер "Контроль" в сделке

    -- ─────────────────────────────────────────────
    -- СТАТУС И ВРЕМЯ ОЖИДАНИЯ ЛИДА (col G-M)
    -- ─────────────────────────────────────────────
    lead_received_at                TIMESTAMPTZ,            -- G: Дата, время поступления лида
    first_contact_attempt_at        TIMESTAMPTZ,            -- H: Дата, время первой попытки связаться
    time_to_first_contact           TEXT,                   -- I: Время ожидания лида до первого касания
    lead_in_work_lt_1_day           BOOLEAN,                -- J: Лид в работе менее суток с даты поступления
    next_contact_not_overdue        BOOLEAN,                -- K: Дата следующего контакта не просрочена/не сдвинута без причины
    lead_in_work_lt_1_day_after_tz  BOOLEAN,                -- L: Лид в работе менее суток с даты получения ТЗ — ТОП 3 вопроса
    deal_in_status_lt_5_days        BOOLEAN,                -- M: Сделка находится в одном статусе менее 5 дней

    -- ─────────────────────────────────────────────
    -- ЗАПОЛНЕНИЕ ПОЛЕЙ И ВЕДЕНИЕ СДЕЛКИ (col N-W)
    -- ─────────────────────────────────────────────
    tz_received                     BOOLEAN,                -- N: ТЗ от клиента получено (ширина, длина, высота, t°, тип нагрева)
    field_buyer_filled              BOOLEAN,                -- O: Заполнение поля "Покупатель" - данные организации
    field_product_category          BOOLEAN,                -- P: Заполнено поле "Категория товара"
    field_contact_data              BOOLEAN,                -- Q: Внесены "Контактные данные клиента"
    relevant_number_found           BOOLEAN,                -- R: Релевантный номер (поиск в интернете если не дозвониться)
    field_expected_amount           BOOLEAN,                -- S: Указана ожидаемая сумма сделки
    field_purchase_form             BOOLEAN,                -- T: Указана "Форма закупки"
    field_sphere_correct            BOOLEAN,                -- U: Указана и указана верно "Сфера деятельности"
    mandatory_comments              BOOLEAN,                -- V: Обязательные комментарии МОПов в сделке (что обсуждали, возражения, след.шаг)
    email_sent_no_answer            BOOLEAN,                -- W: В случае отсутствия ответа - направление писем клиенту

    -- ─────────────────────────────────────────────
    -- ОЦЕНКА РАЗГОВОРОВ (col Z-AC)
    -- ─────────────────────────────────────────────
    calls_status                    TEXT,                   -- Z: Статус звонков
    calls_total_duration            TEXT,                   -- AA: Общая длительность всех разговоров
    calls_attempts_count            INT,                    -- AB: Совершено звонков/попыток дозвона
    calls_evaluated_count           INT,                    -- AC: Количество оцененных звонков в сделке

    -- ─────────────────────────────────────────────
    -- СКРИПТ: УСТАНОВЛЕНИЕ КОНТАКТА (col AD-AE)
    -- ─────────────────────────────────────────────
    script_greeting                 BOOLEAN,                -- AD: Приветствие клиента, представление сотрудника и компании
    script_call_purpose             BOOLEAN,                -- AE: Привязка к пред. шагу, обозначение цели звонка

    -- ─────────────────────────────────────────────
    -- СКРИПТ: ВЫЯВЛЕНИЕ ПОТРЕБНОСТЕЙ (col AF-AH)
    -- ─────────────────────────────────────────────
    script_company_info             BOOLEAN,                -- AF: Чем занимается организация, Бюджет, НДС, Кол-во сотрудников
    script_deadlines                BOOLEAN,                -- AG: Сроки, когда оборудование должно уже стоять
    script_tz_confirmed             BOOLEAN,                -- AH: Убедиться, что ТЗ от клиента получено (параметры камеры)

    -- ─────────────────────────────────────────────
    -- СКРИПТ: РАБОТА С ВОЗРАЖЕНИЯМИ (col AI-AM)
    -- ─────────────────────────────────────────────
    script_objection_general        BOOLEAN,                -- AI: Общая работа с возражениями
    script_objection_delays         BOOLEAN,                -- AJ: Если клиент тянит сроки - выяснить конкурентов
    script_offer_best_tech          BOOLEAN,                -- AK: 1. Наше предложение лучшее по тех. характеристикам?
    script_offer_best_terms         BOOLEAN,                -- AL: 2. Наше предложение лучшее по срокам?
    script_offer_best_price         BOOLEAN,                -- AM: 3. Наше предложение лучшее по цене?

    -- ─────────────────────────────────────────────
    -- В КОНЦЕ ДИАЛОГА (col AN-AO)
    -- ─────────────────────────────────────────────
    script_cross_sell               BOOLEAN,                -- AN: Кросс-продажа (информирование об иных товарах)
    script_next_step_agreed         BOOLEAN,                -- AO: Договоренность о следующем шаге / получение отзыва

    -- ─────────────────────────────────────────────
    -- ВЕДЕНИЕ ДИАЛОГА (col AP-AQ)
    -- ─────────────────────────────────────────────
    script_dialogue_management      BOOLEAN,                -- AP: Управление разговором (инициатива)
    script_confident_speech         BOOLEAN,                -- AQ: Уверенная, спокойная речь. Грамотность.

    -- ─────────────────────────────────────────────
    -- ИТОГОВЫЕ ОЦЕНКИ (col X-Y, AR-AV)
    -- ─────────────────────────────────────────────
    deal_score                      INT,                    -- X: Оценка сделки (балл)
    deal_score_pct                  INT,                    -- Y: % соблюдения правил заполнения/ведения
    script_score                    INT,                    -- AR: Оценка выполнения скрипта (балл)
    script_score_pct                INT,                    -- AS: % соблюдения скрипта
    total_score                     INT,                    -- Итого: общий % (среднее deal+script)
    evaluator_comment               TEXT,                   -- AT: Комментарии оценщика
    objection_note                  TEXT,                   -- AU: ВОЗРАЖЕНИЕ
    op_comment                      TEXT,                   -- AV: Комментарий ОП

    -- Метаданные
    evaluated_by                    TEXT DEFAULT 'maxim',
    score_breakdown                 JSONB,
    created_at                      TIMESTAMPTZ DEFAULT now(),
    updated_at                      TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT okk_order_scores_order_unique UNIQUE (order_id)
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_okk_scores_manager   ON public.okk_order_scores (manager_id);
CREATE INDEX IF NOT EXISTS idx_okk_scores_status    ON public.okk_order_scores (order_status);
CREATE INDEX IF NOT EXISTS idx_okk_scores_total     ON public.okk_order_scores (total_score);
CREATE INDEX IF NOT EXISTS idx_okk_scores_updated   ON public.okk_order_scores (updated_at DESC);

-- Триггер updated_at
CREATE OR REPLACE FUNCTION update_okk_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_okk_scores_updated_at ON public.okk_order_scores;
CREATE TRIGGER trg_okk_scores_updated_at
    BEFORE UPDATE ON public.okk_order_scores
    FOR EACH ROW EXECUTE FUNCTION update_okk_scores_updated_at();

COMMENT ON TABLE public.okk_order_scores IS
    'ОКК-таблица v2: 48 колонок точно по Google Spreadsheet "Чек-лист менеджеры ОП". Семён — факты, Максим — AI-оценка скрипта, Игорь — SLA/время.';
