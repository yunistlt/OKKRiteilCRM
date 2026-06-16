-- Реестр критериев «Контроля качества» (ОКК). Делает 37 ранее захардкоженных в коде
-- критериев управляемыми из БД: ярлык, категория-группа, тип, агент, метод оценки,
-- ИИ-промпт (для скрипт-критериев), корзина итогового балла, порядок, вкл/выкл.
--
-- ВАЖНО: это ТОЛЬКО реестр (источник правды о составе/отображении/промптах).
-- Сам расчёт пока остаётся в lib/okk-evaluator.ts — миграция аддитивна и поведение не меняет.
--
-- eval_method:
--   native       — расчёт в коде, привязан к key (существующая кастомная логика Семёна/Игоря)
--   ai_script    — оценка ИИ по транскрипту, промпт из ai_prompt (Максим) — полностью динамичен
--   field_filled — обобщённый метод «поле(я) заполнено» (для НОВЫХ критериев из UI), ключи в params
--   info         — справочная колонка (текст/число), в балл не входит
-- scoring_basket: 'deal' | 'script' | NULL (не участвует в баллах)

CREATE TABLE IF NOT EXISTS public.okk_criteria (
    key             text PRIMARY KEY,
    label           text NOT NULL,
    category        text NOT NULL,
    group_color     text,
    cell_bg         text,
    type            text NOT NULL DEFAULT 'bool' CHECK (type IN ('bool', 'text', 'num')),
    agent           text,
    agent_emoji     text,
    eval_method     text NOT NULL DEFAULT 'native' CHECK (eval_method IN ('native', 'ai_script', 'field_filled', 'info')),
    ai_prompt       text,
    params          jsonb NOT NULL DEFAULT '{}'::jsonb,
    scoring_basket  text CHECK (scoring_basket IN ('deal', 'script')),
    how_tip         text,
    data_tip        text,
    sort_order      integer NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.okk_criteria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "okk_criteria read all" ON public.okk_criteria;
CREATE POLICY "okk_criteria read all" ON public.okk_criteria FOR SELECT USING (true);
DROP POLICY IF EXISTS "okk_criteria write service" ON public.okk_criteria;
CREATE POLICY "okk_criteria write service" ON public.okk_criteria FOR ALL USING (auth.role() = 'service_role');

GRANT ALL ON public.okk_criteria TO postgres, service_role;
GRANT SELECT ON public.okk_criteria TO anon, authenticated;

-- ── Сид: все 37 критериев в порядке отображения (как в COL_GROUPS) ──
INSERT INTO public.okk_criteria
    (key, label, category, group_color, cell_bg, type, agent, agent_emoji, eval_method, ai_prompt, scoring_basket, how_tip, data_tip, sort_order)
VALUES
-- Группа 1: Статус и время ожидания лида
('time_to_first_contact', 'Время до 1-го касания', 'Статус и время ожидания лида', 'bg-sky-50 text-sky-700', 'bg-sky-50/40', 'text', 'Семён', '🎧', 'info', NULL, NULL, 'Разница между created_at заказа и started_at первого исходящего звонка', 'orders.created_at / raw_telphin_calls.started_at', 10),
('lead_in_work_lt_1_day', 'Лид в работе менее суток с даты поступления', 'Статус и время ожидания лида', 'bg-sky-50 text-sky-700', 'bg-sky-50/40', 'bool', 'Игорь', '👮‍♂️', 'native', NULL, 'deal', 'Проверяет: первый контакт − created_at заказа ≤ 24 часов', 'orders.created_at / raw_telphin_calls.started_at', 20),
('next_contact_not_overdue', 'Дата следующего контакта не просрочена/не сдвинута без причины', 'Статус и время ожидания лида', 'bg-sky-50 text-sky-700', 'bg-sky-50/40', 'bool', 'Игорь', '👮‍♂️', 'native', NULL, 'deal', 'next_contact_date ≥ сегодня', 'raw_payload.customFields.next_contact_date', 30),
('lead_in_work_lt_1_day_after_tz', 'Лид в работе менее суток с даты получения ТЗ', 'Статус и время ожидания лида', 'bg-sky-50 text-sky-700', 'bg-sky-50/40', 'bool', 'Игорь', '👮‍♂️', 'native', NULL, NULL, 'Скорость взятия в работу после получения ТЗ ≤ 24 часов', 'orders.updated_at / raw_payload.customFields', 40),
('deal_in_status_lt_5_days', 'Сделка находится в одном статусе менее 5 дней', 'Статус и время ожидания лида', 'bg-sky-50 text-sky-700', 'bg-sky-50/40', 'bool', 'Игорь', '👮‍♂️', 'native', NULL, 'deal', 'Дней в текущем статусе < нормы статуса (statuses.norm_days)', 'order_history_log / statuses.norm_days', 50),
-- Группа 2: Заполнение полей и ведение
('tz_received', 'ТЗ от клиента получено (ширина, длина, высота, t°, тип нагрева)', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Наличие параметров ТЗ в полях/комментариях (с ИИ-проверкой)', 'raw_payload.customFields / комментарии', 60),
('field_buyer_filled', 'Заполнение поля «Покупатель» — данные организации', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Заполнены company.name / contact.name / customer.*', 'raw_payload.company / contact / customer', 70),
('field_product_category', 'Заполнено поле «Категория товара»', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Категория товара заполнена в customFields', 'raw_payload.customFields', 80),
('field_contact_data', 'Внесены «Контактные данные клиента»', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Заполнены phone / email / contact.phones', 'raw_payload.phone / email / contact.phones', 90),
('relevant_number_found', 'Релевантный номер (поиск в интернете если не дозвониться)', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Есть исходящие звонки по заказу', 'raw_telphin_calls (outgoing) / call_order_matches', 100),
('field_expected_amount', 'Указана ожидаемая сумма сделки', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'customFields.expected_amount > 0 или totalSumm > 0', 'raw_payload.customFields / totalSumm', 110),
('field_purchase_form', 'Указана «Форма закупки»', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Заполнена форма закупки в customFields', 'raw_payload.customFields', 120),
('field_sphere_correct', 'Указана и указана верно «Сфера деятельности»', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Заполнена сфера деятельности в customFields', 'raw_payload.customFields.sfera_deiatelnosti', 130),
('mandatory_comments', 'Обязательные комментарии МОПов в сделке', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'Есть хотя бы одно событие-комментарий по заказу', 'raw_order_events (event_type ILIKE %comment%)', 140),
('email_sent_no_answer', 'В случае отсутствия ответа — направление писем клиенту', 'Заполнение полей и ведение', 'bg-purple-50 text-purple-700', 'bg-purple-50/40', 'bool', 'Семён', '🎧', 'native', NULL, 'deal', 'При недозвоне — есть ли событие отправки письма', 'raw_telphin_calls / raw_order_events (email)', 150),
-- Группа 3: Оценка разговоров (справочные)
('calls_status', 'Статус звонков', 'Оценка разговоров', 'bg-blue-50 text-blue-700', 'bg-blue-50/40', 'text', 'Семён', '🎧', 'info', NULL, NULL, '«Дозвон есть» / «Попытки без ответа» / «Нет звонков»', 'raw_telphin_calls / call_order_matches', 160),
('calls_total_duration', 'Общая длительность всех разговоров', 'Оценка разговоров', 'bg-blue-50 text-blue-700', 'bg-blue-50/40', 'text', 'Семён', '🎧', 'info', NULL, NULL, 'Сумма duration_sec всех звонков по заказу', 'raw_telphin_calls.duration_sec', 170),
('calls_attempts_count', 'Совершено звонков/попыток дозвона', 'Оценка разговоров', 'bg-blue-50 text-blue-700', 'bg-blue-50/40', 'num', 'Семён', '🎧', 'info', NULL, NULL, 'Количество исходящих звонков', 'raw_telphin_calls (outgoing)', 180),
('calls_evaluated_count', 'Количество оцененных звонков в сделке', 'Оценка разговоров', 'bg-blue-50 text-blue-700', 'bg-blue-50/40', 'num', 'Семён', '🎧', 'info', NULL, NULL, 'Звонки с расшифровкой (transcript != null)', 'raw_telphin_calls.transcript', 190),
-- Группа 4: Установление контакта (скрипт)
('script_greeting', 'Приветствие клиента, представление сотрудника и компании', 'Установление контакта', 'bg-emerald-50 text-emerald-700', 'bg-emerald-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Приветствие и название компании. Есть приветствие + представление по имени + компания — true, иначе false.', 'script', 'GPT анализирует транскрипт: приветствие + представление + компания', 'raw_telphin_calls.transcript → GPT', 200),
('script_call_purpose', 'Привязка к предыдущему шагу, обозначение цели звонка', 'Установление контакта', 'bg-emerald-50 text-emerald-700', 'bg-emerald-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Озвучена причина звонка (привязка к заказу/этапу). Есть — true, нет — false.', 'script', 'GPT: напомнил контекст прошлого диалога и назвал цель', 'raw_telphin_calls.transcript → GPT', 210),
-- Группа 5: Выявление потребностей и БА
('script_company_info', 'Чем занимается организация', 'Выявление потребностей и БА', 'bg-teal-50 text-teal-700', 'bg-teal-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Выявлена сфера деятельности клиента и чем занимается организация. Есть — true, нет — false.', 'script', 'GPT: выявлена ли сфера деятельности клиента', 'raw_telphin_calls.transcript → GPT', 220),
('script_lpr_identified', 'Выявление ЛПР', 'Выявление потребностей и БА', 'bg-teal-50 text-teal-700', 'bg-teal-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Выявлено Лицо, Принимающее Решение (кто ещё участвует в выборе). Есть — true, нет — false.', 'script', 'GPT/Анна: выявлено ли ЛПР', 'Anna.lpr / GPT', 230),
('script_budget_confirmed', 'Подтверждение бюджета', 'Выявление потребностей и БА', 'bg-teal-50 text-teal-700', 'bg-teal-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Обсуждён финансовый вопрос или наличие бюджета. Есть — true, нет — false.', 'script', 'GPT/Анна: обсуждался ли финансовый вопрос', 'Anna.budget / GPT', 240),
('script_urgency_identified', 'Срочность покупки', 'Выявление потребностей и БА', 'bg-teal-50 text-teal-700', 'bg-teal-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Менеджер выяснил срочность покупки (нужно «вчера» или «к осени»). Есть — true, нет — false.', 'script', 'GPT/Анна: выяснено ли «когда нужно»', 'Anna.urgency / GPT', 250),
('script_deadlines', 'Сроки поставки', 'Выявление потребностей и БА', 'bg-teal-50 text-teal-700', 'bg-teal-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Выяснены конкретные сроки готовности/поставки (не путать со срочностью). Есть — true, нет — false.', 'script', 'GPT: уточнены ли конкретные сроки', 'raw_telphin_calls.transcript → GPT', 260),
('script_tz_confirmed', 'Параметры ТЗ (камера)', 'Выявление потребностей и БА', 'bg-teal-50 text-teal-700', 'bg-teal-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Параметры тех. задания (размеры, температура, нагрев) подтверждены. Есть — true, нет — false.', 'script', 'GPT: подтверждено получение ТЗ с параметрами', 'raw_telphin_calls.transcript → GPT', 270),
-- Группа 6: Работа с возражениями
('script_objection_general', 'Общая работа с возражениями', 'Работа с возражениями', 'bg-orange-50 text-orange-700', 'bg-orange-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Работа с возражениями. Были возражения и отработаны — true. Возражений не было или не отработаны — false.', 'script', 'GPT: присутствует ли отработка возражений', 'raw_telphin_calls.transcript → GPT', 280),
('script_objection_delays', 'Если клиент тянет сроки — выяснить конкурентов', 'Работа с возражениями', 'bg-orange-50 text-orange-700', 'bg-orange-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'При затягивании клиента — выяснены ли конкуренты и причина. Да — true, нет — false.', 'script', 'GPT: при затягивании выяснены ли конкуренты', 'raw_telphin_calls.transcript → GPT', 290),
('script_offer_best_tech', '1. Наше предложение лучшее по тех. характеристикам?', 'Работа с возражениями', 'bg-orange-50 text-orange-700', 'bg-orange-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Аргументация через технические преимущества предложения. Была — true, нет — false.', 'script', 'GPT: аргументированы ли тех. преимущества', 'raw_telphin_calls.transcript → GPT', 300),
('script_offer_best_terms', '2. Наше предложение лучшее по срокам?', 'Работа с возражениями', 'bg-orange-50 text-orange-700', 'bg-orange-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Аргументы по срокам поставки. Были — true, нет — false.', 'script', 'GPT: аргументированы ли преимущества по срокам', 'raw_telphin_calls.transcript → GPT', 310),
('script_offer_best_price', '3. Наше предложение лучшее по цене?', 'Работа с возражениями', 'bg-orange-50 text-orange-700', 'bg-orange-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Обоснование цены. Было — true, нет — false.', 'script', 'GPT: аргументированы ли ценовые преимущества', 'raw_telphin_calls.transcript → GPT', 320),
-- Группа 7: В конце диалога
('script_cross_sell', 'Кросс-продажа (информирование об иных товарах)', 'В конце диалога', 'bg-pink-50 text-pink-700', 'bg-pink-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Предложение сопутствующих товаров/услуг. Было — true, нет — false.', 'script', 'GPT: упомянуто ли иное оборудование/услуги', 'raw_telphin_calls.transcript → GPT', 330),
('script_next_step_agreed', 'Договорённость о следующем шаге / получение отзыва', 'В конце диалога', 'bg-pink-50 text-pink-700', 'bg-pink-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Фиксация следующего шага с датой. Есть дата следующего касания — true, нет — false.', 'script', 'GPT: зафиксирован ли следующий шаг/запрос отзыва', 'raw_telphin_calls.transcript → GPT', 340),
-- Группа 8: Ведение диалога
('script_dialogue_management', 'Управление разговором (инициатива)', 'Ведение диалога', 'bg-violet-50 text-violet-700', 'bg-violet-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Менеджер держал инициативу и вёл разговор по структуре. Да — true, нет — false.', 'script', 'GPT: держал ли менеджер инициативу', 'raw_telphin_calls.transcript → GPT', 350),
('script_confident_speech', 'Уверенная, спокойная речь. Грамотность.', 'Ведение диалога', 'bg-violet-50 text-violet-700', 'bg-violet-50/40', 'bool', 'Максим', '🤓', 'ai_script', 'Уверенная, спокойная, грамотная речь (паузы, слова-паразиты). Да — true, нет — false.', 'script', 'GPT: оценивает стиль речи', 'raw_telphin_calls.transcript → GPT', 360),
-- Группа 9: Реактивация (справочная)
('reactivation_status', 'Статус рассылки', 'Реактивация (Виктория)', 'bg-emerald-50 text-emerald-700', 'bg-emerald-50/40', 'text', 'Виктория', '👩‍💼', 'info', NULL, NULL, 'Отправлено (✉️), прочитано (👁️), ответил (💬)', 'ai_outreach_logs (status, opened_at)', 370)
ON CONFLICT (key) DO NOTHING;
