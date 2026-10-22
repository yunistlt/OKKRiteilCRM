import { AGENT_PROFILES } from '@/lib/agents-catalog';

/**
 * Очистка имени клиента, которое ИИ вытащил из диалога/письма.
 *
 * Зачем: в чате на сайте представляется наш бот («Я Елена, инженер-консультант
 * ЗМК»), и модель регулярно записывала ЕГО имя как имя клиента — в карточке
 * появлялся контакт «ИИ-Лид Елена», менеджер писал мужчине «Елена, добрый день»
 * (доработка №35, Елена Парфёнова, 22.10.2026). Имена ботов берём из каталога
 * агентов, чтобы список не разъезжался при появлении новой персоны.
 *
 * Пустое имя — норма: в карточке остаётся «ИИ-Лид», это честнее выдуманного.
 */

/** Имена наших ИИ-персон (Елена, Семён, Катерина, …) — источник один, каталог. */
const PERSONA_NAMES = new Set(
    AGENT_PROFILES.map((agent) => agent.name.trim().toLowerCase()).filter(Boolean)
);

/** Заглушки, которые бот подставляет сам, — именем клиента они не являются. */
const PLACEHOLDER_NAMES = new Set([
    'клиент',
    'клиент из чата',
    'ии',
    'ии-лид',
    'лид',
    'аноним',
    'менеджер',
    'консультант',
    'оператор',
    'не указано',
    'неизвестно',
    'null',
]);

/**
 * `null`, если это имя нашего бота, заглушка или никнейм сессии;
 * иначе — имя клиента без кавычек и лишних пробелов.
 */
export function sanitizeClientName(raw?: string | null, sessionNickname?: string | null): string | null {
    const value = String(raw ?? '').replace(/["'«»]/g, '').replace(/\s+/g, ' ').trim();
    if (!value) return null;

    const lower = value.toLowerCase();
    if (PLACEHOLDER_NAMES.has(lower)) return null;
    if (sessionNickname && lower === sessionNickname.trim().toLowerCase()) return null;
    if (PERSONA_NAMES.has(lower)) return null;

    // «Елена (ЗМК)», «Елена, ЗМК», «Елена из ЗМК» — тоже наш бот.
    const firstWord = lower.split(/[\s,(]/)[0];
    if (PERSONA_NAMES.has(firstWord)) return null;

    return value;
}
