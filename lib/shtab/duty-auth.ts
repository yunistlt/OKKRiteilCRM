import { createHash, timingSafeEqual } from 'node:crypto';

// Доступ ЦехУспеха к служебному API Штаба.
//
// Сессии у внешней системы нет, поэтому маршруты /api/duty пропущены мимо
// проверки сессии в middleware и закрыты токеном здесь. Токен общий на систему:
// он говорит «это ЦехУспех», а КТО спрашивает — говорит внешний идентификатор в
// запросе. Разделять эти две вещи важно: токен подтверждает систему, а не
// человека, и на нём одном права строиться не могут.

const ENV = 'SHTAB_DUTY_TOKEN';

export function dutyTokenConfigured(): boolean {
    const raw = process.env[ENV]?.trim();
    return Boolean(raw && raw.length >= 24);
}

/**
 * Сверяет токен из заголовка.
 *
 * Сравнение постоянного времени: обычное сравнение строк выдаёт по времени, где
 * именно они разошлись, и токен подбирается по одному символу.
 */
export function checkDutyToken(authHeader: string | null): boolean {
    const expected = process.env[ENV]?.trim();
    if (!expected || expected.length < 24) return false;

    // Сначала обрезаем края, потом снимаем приставку: заголовок мог пройти через
    // прокси, добавивший пробел, и из-за этого верный токен отвергался бы.
    const got = (authHeader || '').trim().replace(/^Bearer\s+/i, '').trim();
    if (!got) return false;

    // Через хеш, чтобы сравнивать буферы одинаковой длины: иначе timingSafeEqual
    // бросит исключение на строках разной длины и сам станет утечкой.
    const a = createHash('sha256').update(got).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
}
