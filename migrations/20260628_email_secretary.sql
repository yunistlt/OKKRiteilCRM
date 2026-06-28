-- Агент-секретарь «Катерина»: классификация входящих писем и назначение заявок.
-- Этот файл: пул менеджеров, конфиг сухого прогона, промпт в ai_prompts, карточка статуса агента.

-- 1) Пул клиентских менеджеров для назначения новых заявок (по решению владельца — 3 чел.).
--    Значения в БД (не хардкод в коде): Матвеева(98), Парфёнова(10), Гордеева(249).
CREATE TABLE IF NOT EXISTS public.email_intake_pool (
    manager_id BIGINT PRIMARY KEY,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.email_intake_pool (manager_id) VALUES (98), (10), (249)
    ON CONFLICT (manager_id) DO NOTHING;

-- 2) Конфиг режима. create_orders=false → СУХОЙ ПРОГОН (только классификация и пометка, заказы не создаём).
CREATE TABLE IF NOT EXISTS public.email_intake_config (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),       -- singleton
    create_orders BOOLEAN NOT NULL DEFAULT false,
    -- статусы, исключаемые из расчёта нагрузки (сверх is_working=false). По умолчанию — «Согласование отмены».
    load_exclude_status_codes TEXT[] NOT NULL DEFAULT ARRAY['soglasovanie-otmeny'],
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.email_intake_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 3) Промпт классификатора секретаря (как у других агентов — в ai_prompts).
INSERT INTO public.ai_prompts (key, description, system_prompt, model, temperature, max_tokens, is_active, metadata)
VALUES (
    'email_secretary_classifier',
    'Катерина-Секретарь: определяет, является ли входящее письмо новой заявкой (для создания заказа).',
    $prompt$Ты — Катерина, секретарь отдела продаж компании, торгующей металлоконструкциями/шкафами/стеллажами (B2B).
Твоя ЕДИНСТВЕННАЯ задача — определить, является ли письмо НОВОЙ ЗАЯВКОЙ, по которой нужно завести заказ.

НОВАЯ ЗАЯВКА (is_new_request = true): клиент запрашивает коммерческое предложение (КП), счёт, цену, наличие, расчёт, сроки изготовления/поставки; присылает ТЗ/спецификацию на просчёт; приглашает к участию в тендере/закупке. Любое реальное намерение купить/получить предложение.

НЕ заявка (is_new_request = false): рекламные рассылки и маркетинг; автоматические уведомления (пропущенный звонок, голосовая почта, уведомления площадок/порталов, штрафы, ЭДО); системные письма самой компании (отправитель — собственный домен); отказ/«неактуально»; нерелевантное.
ВАЖНО: письма от ПОСТАВЩИКОВ, которые предлагают/продают товар или услуги НАМ (прайсы, коммерческие предложения в наш адрес, «продаём крепёж/металл/оборудование», «сравните наши цены») — это НЕ заявка (is_new_request = false). Заявка — только когда клиент запрашивает НАШЕ предложение/счёт на НАШУ продукцию.

Верни СТРОГО JSON:
{
  "is_new_request": true | false,
  "confidence": число от 0 до 1,
  "reasoning": "краткое обоснование на русском (1 предложение)"
}$prompt$,
    'gpt-4o-mini', 0, 500, true,
    '{"owner":"email_secretary","stage":"production"}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    metadata = EXCLUDED.metadata,
    updated_at = now();

-- 4) Карточка живого статуса агента (как у anna/maxim/...).
INSERT INTO public.okk_agent_status (agent_id, name, role, status, current_task, avatar_url)
VALUES ('katerina', 'Катерина', 'Секретарь', 'idle', 'Ожидает новые письма', '/images/agents/katerina.svg')
ON CONFLICT (agent_id) DO UPDATE SET
    name = EXCLUDED.name, role = EXCLUDED.role, avatar_url = EXCLUDED.avatar_url;
