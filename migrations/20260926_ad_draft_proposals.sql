-- Предложения создать объявление в Яндекс Директе.
--
-- Тамара умеет читать рекламу и предлагать новые объявления, но не создавать
-- их сама. Причина та же, что у настроек, только дороже: реклама тратит
-- настоящие деньги, и цена неверно понятой фразы здесь измеряется в рублях.
--
-- Между моделью и Директом стоит человек. Строка появляется здесь от модели,
-- владелец видит её карточкой в разговоре и нажимает «создать» или
-- «отклонить». Даже после подтверждения объявление создаётся ЧЕРНОВИКОМ и на
-- модерацию не уходит: показов у него нет, пока владелец сам не отправит его
-- в интерфейсе Директа. Это второй предохранитель — на случай, если первый
-- нажали не думая.
--
-- Таблица заодно отвечает на вопрос «откуда взялось это объявление и зачем»:
-- через месяц по тексту в Директе этого уже не восстановить.

CREATE TABLE IF NOT EXISTS public.ad_draft_proposal (
    id               BIGSERIAL PRIMARY KEY,
    -- Куда кладём. Группа объявлений уже существует: создавать кампании с нуля
    -- модель не умеет и не должна — у кампании есть бюджет и стратегия.
    ad_group_id      BIGINT NOT NULL,
    campaign_name    TEXT,
    ad_group_name    TEXT,
    -- Само объявление.
    title            TEXT NOT NULL,
    title2           TEXT,
    body             TEXT NOT NULL,
    href             TEXT NOT NULL,
    -- Фразы, под которые оно написано. Пока только для глаз владельца: ставить
    -- их в Директ — отдельное действие, оно влияет на расход.
    keywords         TEXT,
    -- Зачем это объявление и на чём оно основано. Без второго «предлагаю новое
    -- объявление» невозможно перепроверить.
    reason           TEXT NOT NULL,
    evidence         TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'created', 'rejected', 'failed')),
    -- Что вернул Директ: номер созданного объявления либо текст отказа.
    direct_ad_id     BIGINT,
    error            TEXT,
    -- Создано ли в песочнице. Без этой отметки через неделю не понять, почему
    -- объявления нет в кабинете.
    sandbox          BOOLEAN NOT NULL DEFAULT false,
    conversation_id  BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at       TIMESTAMPTZ,
    decided_by       TEXT
);

-- Открытых предложений всегда мало, а спрашивают про них на каждой отрисовке.
CREATE INDEX IF NOT EXISTS idx_ad_draft_pending
    ON public.ad_draft_proposal (created_at DESC)
    WHERE status = 'pending';

ALTER TABLE public.ad_draft_proposal ENABLE ROW LEVEL SECURITY;
