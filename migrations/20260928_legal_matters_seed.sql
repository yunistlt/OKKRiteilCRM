-- Справочники раздела претензионно-исковой работы.
-- Русские названия живут ТОЛЬКО здесь: в коде ходят коды, на экране показываем name.
-- Правка названий — в интерфейсе, без деплоя.

INSERT INTO public.legal_matter_dictionaries (kind, code, name, description, color, sort_order) VALUES
-- Стадии дела: один конфликт проходит их по очереди, ID не меняется
('stage', 'claim',       'Претензия',                 'Досудебный этап: претензия получена или направлена', '#f59e0b', 10),
('stage', 'talks',       'Переговоры',                'Урегулирование без суда',                            '#eab308', 20),
('stage', 'lawsuit',     'Подготовка иска',           'Решение судиться принято, иск готовится',            '#f97316', 30),
('stage', 'court',       'Суд',                       'Дело рассматривается судом',                         '#3b82f6', 40),
('stage', 'appeal',      'Обжалование',               'Апелляция или кассация',                             '#6366f1', 50),
('stage', 'enforcement', 'Исполнительное производство','Решение есть, идёт взыскание',                      '#a855f7', 60),
('stage', 'closed',      'Закрыто',                   'Работа по делу завершена',                           '#6b7280', 70),

-- Статусы: больше семи не заводим, иначе руководителю сложнее, а не проще
('status', 'new',                 'Новое',                      NULL, '#22c55e', 10),
('status', 'in_work',             'В работе',                   NULL, '#eab308', 20),
('status', 'waiting_counterparty','Ждём контрагента',           'Ход за другой стороной', '#f97316', 30),
('status', 'court',               'Судебное производство',      NULL, '#3b82f6', 40),
('status', 'enforcement',         'Исполнение',                 NULL, '#a855f7', 50),
('status', 'paused',              'Приостановлено',             NULL, '#94a3b8', 60),
('status', 'closed',              'Закрыто',                    NULL, '#6b7280', 70),

-- Наша роль в споре
('matter_side', 'claimant',   'Мы требуем',   'Наша претензия к контрагенту, в том числе дебиторка', NULL, 10),
('matter_side', 'respondent', 'Требуют с нас','Претензия контрагента к нам',                        NULL, 20),

-- Категории спора
('category', 'postavka',    'Поставка',              NULL, NULL, 10),
('category', 'podryad',     'Подряд',                NULL, NULL, 20),
('category', 'arenda',      'Аренда',                NULL, NULL, 30),
('category', 'debitorka',   'Дебиторка',             'Неоплата в нашу пользу', NULL, 40),
('category', 'trudovoj',    'Трудовой спор',         NULL, NULL, 50),
('category', 'nalogovyj',   'Налоговый спор',        NULL, NULL, 60),
('category', 'intellekt',   'Интеллектуальные права',NULL, NULL, 70),
('category', 'other',       'Прочее',                NULL, NULL, 99),

-- Причины возникновения
('cause', 'brak',        'Брак',                  NULL, NULL, 10),
('cause', 'prosrochka',  'Просрочка',             NULL, NULL, 20),
('cause', 'neoplata',    'Неоплата',              NULL, NULL, 30),
('cause', 'narushenie',  'Нарушение договора',    NULL, NULL, 40),
('cause', 'other',       'Прочее',                NULL, NULL, 99),

-- Виды событий журнала
('event_kind', 'claim_in',     'Получена претензия',        NULL, NULL, 10),
('event_kind', 'claim_out',    'Направлена претензия',      NULL, NULL, 20),
('event_kind', 'reply',        'Направлен ответ',           NULL, NULL, 30),
('event_kind', 'talks',        'Переговоры',                NULL, NULL, 40),
('event_kind', 'filing',       'Подан иск',                 NULL, NULL, 50),
('event_kind', 'hearing',      'Судебное заседание',        NULL, NULL, 60),
('event_kind', 'ruling',       'Судебный акт',              NULL, NULL, 70),
('event_kind', 'writ',         'Исполнительный лист',       NULL, NULL, 80),
('event_kind', 'payment',      'Оплата',                    NULL, NULL, 90),
('event_kind', 'stage_change', 'Смена стадии',              NULL, NULL, 95),
('event_kind', 'note',         'Заметка',                   NULL, NULL, 99),

-- Результат претензии
('claim_result', 'otklonena',    'Отклонена',            NULL, NULL, 10),
('claim_result', 'udovletvorena','Удовлетворена',        NULL, NULL, 20),
('claim_result', 'chastichno',   'Удовлетворена частично',NULL, NULL, 30),
('claim_result', 'peregovory',   'Перешли в переговоры', NULL, NULL, 40),

-- Оценка риска: только уровни, никаких «шансы 80%»
('risk_level', 'low',    'Низкий',  NULL, '#22c55e', 10),
('risk_level', 'medium', 'Средний', NULL, '#eab308', 20),
('risk_level', 'high',   'Высокий', NULL, '#ef4444', 30),

-- Причины закрытия
('close_reason', 'settled',    'Урегулировано',        NULL, NULL, 10),
('close_reason', 'won',        'Выиграно',             NULL, NULL, 20),
('close_reason', 'lost',       'Проиграно',            NULL, NULL, 30),
('close_reason', 'partial',    'Частично',             NULL, NULL, 40),
('close_reason', 'withdrawn',  'Отказались от требований', NULL, NULL, 50),
('close_reason', 'uncollectible','Безнадёжно к взысканию', NULL, NULL, 60)
ON CONFLICT (kind, code) DO NOTHING;
