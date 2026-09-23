-- Предложения изменить настройку сервиса.
--
-- Тамара умеет читать настройки и предлагать их изменить, но не применять:
-- поднятая на 5% нагрузка назавтра уезжает живым людям в телегу, и цена
-- неверно понятой фразы — рабочий день пятерых человек. Поэтому между моделью
-- и продом стоит человек: строка здесь появляется от модели, статус меняет
-- владелец нажатием в интерфейсе.
--
-- Таблица заодно отвечает на вопрос «кто это поменял и зачем»: до сих пор
-- настройка менялась молча, и понять, почему в марте нагрузка стала 1.2,
-- было неоткуда.

CREATE TABLE IF NOT EXISTS public.setting_change_proposal (
    id              BIGSERIAL PRIMARY KEY,
    -- Адрес ручки в реестре: sales_rop.load_factor, okk.<код>.active.
    knob_id         TEXT NOT NULL,
    module          TEXT NOT NULL,
    -- Снимок на момент предложения: по нему видно, что человек подтверждал.
    -- Настройка могла измениться между предложением и подтверждением, поэтому
    -- перед применением значение читается заново и сверяется с этим.
    title           TEXT NOT NULL,
    current_value   TEXT,
    new_value       TEXT NOT NULL,
    -- Для версионируемых по дате настроек мотивации.
    effective_from  DATE,
    -- Зачем меняем — формулировка модели. Уходит в примечание к версии.
    reason          TEXT NOT NULL,
    -- Чем модель это обосновала: какие числа увидела. Без этого «подними на 5%»
    -- невозможно перепроверить.
    evidence        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
    -- Из какого разговора пришло предложение.
    conversation_id BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ,
    decided_by      TEXT,
    -- Текст ошибки, если применение не удалось: предложение не исчезает, а
    -- остаётся с объяснением.
    error           TEXT
);

-- Открытых предложений всегда мало, а спрашивают про них на каждой отрисовке.
CREATE INDEX IF NOT EXISTS idx_setting_change_pending
    ON public.setting_change_proposal (created_at DESC)
    WHERE status = 'pending';

-- Одна и та же ручка не должна висеть в двух открытых предложениях: человек
-- подтвердил бы оба и получил то из них, что применилось вторым.
CREATE UNIQUE INDEX IF NOT EXISTS uq_setting_change_pending_knob
    ON public.setting_change_proposal (knob_id)
    WHERE status = 'pending';

ALTER TABLE public.setting_change_proposal ENABLE ROW LEVEL SECURITY;
