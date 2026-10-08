/**
 * Тред переписки по заказу.
 *
 * Тред — вычисляемая величина, а не хранимая запись: письма уже лежат в своих
 * канонических таблицах, и копировать их в третью — значит завести второго
 * писателя (см. `docs/order-mail/PLAN.md`). Здесь только сборка: из плоского
 * списка писем получаем разговоры, как их видит человек.
 *
 * Постановка: `docs/order-mail/TZ.md` §2–§4.
 */

export type MailDirection = 'in' | 'out';

/** Письмо, как его отдаёт база, независимо от таблицы. */
export type MailMessage = {
    /** «in:<id>» или «out:<id>» — письма лежат в разных таблицах. */
    key: string;
    direction: MailDirection;
    messageId: string | null;
    inReplyTo: string | null;
    references: string[];
    subject: string | null;
    from: string | null;
    fromName: string | null;
    to: string | null;
    at: string | null;
    body: string | null;
    attachments: Array<{ name: string; size: number | null }>;
    /** Для ссылки на вложение входящего письма. */
    sourceId: string | null;
    read: boolean;
};

export type MailThread = {
    key: string;
    subject: string;
    messages: MailMessage[];
    lastAt: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    unread: number;
    /** Коды: в интерфейс идут русские названия (закон «человеческий язык»). */
    state: 'awaiting_us' | 'awaiting_client' | 'closed';
    /** Участники со стороны клиента — кому отвечать. */
    participants: string[];
};

/**
 * Идентификатор письма в угловых скобках: `<abc@mail.ru>`. Клиенты пишут их
 * по-разному, поэтому сравниваем без скобок и регистра.
 */
export function normalizeMessageId(value: unknown): string | null {
    const raw = String(value ?? '').trim().replace(/^<|>$/g, '').trim();
    return raw ? raw.toLowerCase() : null;
}

/** Все идентификаторы из заголовка References. */
export function parseReferences(value: unknown): string[] {
    const raw = Array.isArray(value) ? value.join(' ') : String(value ?? '');
    return raw
        .split(/[\s,]+/)
        .map((item) => normalizeMessageId(item))
        .filter((item): item is string => Boolean(item));
}

/**
 * Тема без служебного: «Re:», «Fwd:», «Ответ:» и наш тег `[#2/54905]`.
 *
 * Кириллица в регулярках: `\w` и `\b` с русскими буквами не работают, поэтому
 * префиксы перечислены явно (грабля проекта `js-regex-cyrillic-trap`).
 */
export function normalizeSubject(value: unknown): string {
    let text = String(value ?? '').replace(/\[#[^\]]*\]/g, ' ');
    // Префиксы снимаем по кругу: «Re: Fwd: Re: тема» — обычное дело.
    for (let i = 0; i < 10; i += 1) {
        const stripped = text.replace(/^\s*(re|fw|fwd|ответ|пересылка)\s*(\[\d+\])?\s*:\s*/i, '');
        if (stripped === text) break;
        text = stripped;
    }
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Где начинается цитата предыдущего письма.
 *
 * Разные клиенты режут по-разному, поэтому ищем первый из известных признаков:
 * «-----Исходное сообщение-----», «<дата>, <имя> писал(а):», «On … wrote:»,
 * шапку «От кого:» и строки, начинающиеся с «>».
 *
 * Возвращает смещение в символах или null, если цитаты нет.
 */
export function quoteOffset(body: string | null | undefined): number | null {
    const text = String(body ?? '');
    if (!text) return null;

    const marks: RegExp[] = [
        /^-{2,}\s*(исходное сообщение|original message|пересылаемое сообщение)\s*-{2,}\s*$/im,
        /^\s*(\d{1,2}[.\s][^\n]{0,60}),\s*[^\n]{0,80}(писал|писала|пишет)\(?а?\)?:\s*$/im,
        /^\s*on\s[^\n]{0,120}\swrote:\s*$/im,
        /^\s*от кого:\s*/im,
        /^\s*>{1,}\s?/m,
    ];

    let found: number | null = null;
    for (const mark of marks) {
        const match = mark.exec(text);
        if (match && match.index >= 0 && (found === null || match.index < found)) {
            found = match.index;
        }
    }

    // Цитата в самом начале — значит письмо из одной цитаты и резать нечего.
    return found !== null && found > 0 ? found : null;
}

/** Видимая часть письма — без цитаты. */
export function visibleBody(message: MailMessage): { text: string; quoted: string | null } {
    const body = String(message.body ?? '');
    const offset = quoteOffset(body);
    if (offset === null) return { text: body, quoted: null };
    return { text: body.slice(0, offset).trim(), quoted: body.slice(offset) };
}

/**
 * Ключ треда для письма.
 *
 * Сначала по цепочке ответов — она переживает и смену темы, и пересылку.
 * Нет ни `In-Reply-To`, ни `References` — считаем тред по нормализованной теме:
 * в общей почте это единственное, что связывает письма клиента между собой.
 */
function threadKeyOf(message: MailMessage, byMessageId: Map<string, string>): string {
    const chain = [...message.references, message.inReplyTo]
        .map((item) => normalizeMessageId(item))
        .filter((item): item is string => Boolean(item));

    for (const id of chain) {
        const known = byMessageId.get(id);
        if (known) return known;
    }

    const subject = normalizeSubject(message.subject);
    return subject ? `subj:${subject.toLowerCase()}` : `msg:${message.key}`;
}

/**
 * Собрать письма в треды. Письма приходят в любом порядке — сортируем сами.
 *
 * @param closedKeys ключи тредов, закрытых менеджером руками.
 */
export function buildThreads(messages: MailMessage[], closedKeys: Set<string> = new Set()): MailThread[] {
    const ordered = [...messages].sort(
        (a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime(),
    );

    // Идентификатор письма → ключ его треда. Заполняем по ходу: ответ всегда
    // приходит позже письма, на которое отвечает.
    const byMessageId = new Map<string, string>();
    const groups = new Map<string, MailMessage[]>();

    for (const message of ordered) {
        const key = threadKeyOf(message, byMessageId);
        const own = normalizeMessageId(message.messageId);
        if (own) byMessageId.set(own, key);
        const group = groups.get(key);
        if (group) group.push(message);
        else groups.set(key, [message]);
    }

    const threads: MailThread[] = [];

    for (const [key, group] of Array.from(groups.entries())) {
        const last = group[group.length - 1];
        const inbound = group.filter((m) => m.direction === 'in');
        const outbound = group.filter((m) => m.direction === 'out');
        const at = (list: MailMessage[]): string | null => (list.length ? list[list.length - 1].at : null);

        const state: MailThread['state'] = closedKeys.has(key)
            ? 'closed'
            : last.direction === 'in' ? 'awaiting_us' : 'awaiting_client';

        threads.push({
            key,
            // Тема треда — из первого письма: в ответах она обрастает «Re:».
            subject: normalizeSubject(group[0].subject) || 'Без темы',
            messages: group,
            lastAt: last.at,
            lastInboundAt: at(inbound),
            lastOutboundAt: at(outbound),
            // Непрочитанными считаем только входящие: свои письма человек видел.
            unread: inbound.filter((m) => !m.read).length,
            state,
            participants: Array.from(new Set(
                inbound.map((m) => m.from).filter((item): item is string => Boolean(item)),
            )),
        });
    }

    // Свежие разговоры сверху; закрытые уходят вниз — как архив в почте.
    return threads.sort((a, b) => {
        if ((a.state === 'closed') !== (b.state === 'closed')) return a.state === 'closed' ? 1 : -1;
        return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
    });
}

/** Человеческое название состояния — для интерфейса. */
export function stateLabel(state: MailThread['state']): string {
    if (state === 'awaiting_us') return 'Ждём нас';
    if (state === 'awaiting_client') return 'Ждём клиента';
    return 'Закрыт';
}
