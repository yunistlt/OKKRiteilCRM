-- Тамара пишет владельцу в телеграм.
--
-- До сих пор разговор с ней был только в браузере: чтобы что-то узнать, надо
-- было прийти и спросить. Ежедневный отчёт — обратный ход: она приходит сама.
--
-- Два ограничения заложены в устройство, а не в инструкцию модели.
--
-- Адресат один и хранится здесь. Инструмент отправки не принимает чужой чат:
-- модель, умеющая писать кому угодно, однажды напишет не тому, и это будет
-- сообщение о делах компании постороннему человеку.
--
-- Подпись обязательна и добавляется кодом. Бот один на весь сервис, и в чате
-- владельца уже лежат сообщения от бота-РОПа и оповещения о сбоях: без подписи
-- нельзя понять, кто это сказал и с кого спрашивать за сказанное.

CREATE TABLE IF NOT EXISTS public.shtab_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    comment     TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shtab_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.shtab_settings (key, value, comment) VALUES
    ('telegram_chat_id', '', 'Чат владельца: единственный адресат Тамары. Пусто — берётся чат из настроек бота-РОПа'),
    ('daily_report_enabled', 'true', 'Присылать ли ежедневный отчёт'),
    ('daily_report_hour', '8', 'Час отправки отчёта по местному времени'),
    ('telegram_signature', 'Тамара, наставник', 'Чем подписывается каждое её сообщение')
ON CONFLICT (key) DO NOTHING;

-- Что она уже отправляла. Нужно ей самой: форму отчёта она выбирает сама, и без
-- памяти о вчерашнем отчёт каждый день выходил бы новым — а к отчёту привыкают
-- и читают его по привычным местам. Плюс защита от повтора: два одинаковых
-- отчёта за один день означают, что крон отработал дважды.
CREATE TABLE IF NOT EXISTS public.shtab_tamara_outbox (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'message',
    text        TEXT NOT NULL,
    chat_id     TEXT NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Какого числа отчёт: по нему видно, что за день уже отчитались.
    report_date DATE,
    ok          BOOLEAN NOT NULL DEFAULT true,
    error       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tamara_daily_report
    ON public.shtab_tamara_outbox (report_date)
    WHERE kind = 'daily_report' AND ok;

ALTER TABLE public.shtab_tamara_outbox ENABLE ROW LEVEL SECURITY;
