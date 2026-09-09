import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Шифрование refresh-токена Google перед записью в базу.
//
// Refresh-токен не истекает сам и даёт доступ к календарю владельца до отзыва.
// В базе он лежит рядом с прочими данными Штаба, а доступ к базе шире, чем к
// календарю: сервисная роль читает все таблицы. Шифрование сужает это обратно —
// без ключа из окружения строка в таблице бесполезна.
//
// AES-256-GCM, а не CBC: GCM проверяет целостность, и подменённый шифротекст
// не расшифруется молча в мусор.

const KEY_ENV = 'SHTAB_TOKEN_KEY';
const IV_BYTES = 12;   // рекомендованная длина для GCM
const TAG_BYTES = 16;

/**
 * Ключ шифрования из окружения.
 *
 * Значение любой длины сворачивается в 32 байта хешем: так подойдёт и случайная
 * строка из генератора паролей, а не только ровно 32 символа. Отсутствие ключа —
 * ошибка, а не повод хранить токен открытым.
 */
function key(): Buffer {
    const raw = process.env[KEY_ENV]?.trim();
    if (!raw) {
        throw new Error(
            `Нет ${KEY_ENV}. Без него refresh-токен Google пришлось бы хранить открытым — это не делается.`,
        );
    }
    if (raw.length < 16) {
        throw new Error(`${KEY_ENV} слишком короткий: нужно не меньше 16 символов.`);
    }
    return createHash('sha256').update(raw).digest();
}

export function tokenKeyConfigured(): boolean {
    const raw = process.env[KEY_ENV]?.trim();
    return Boolean(raw && raw.length >= 16);
}

/** Шифрует строку. Результат — base64 из «iv + tag + шифротекст». */
export function encryptToken(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Расшифровывает строку, полученную от encryptToken. */
export function decryptToken(packed: string): string {
    const raw = Buffer.from(packed, 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error('Зашифрованный токен повреждён: слишком короткий');

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// ── подпись параметра state ───────────────────────────────────────────────────

/**
 * Подписывает state для OAuth.
 *
 * Без подписи чужой запрос на адрес возврата подсунул бы свой код авторизации, и
 * к Штабу оказался бы привязан чужой календарь. Подпись привязывает state к
 * нашему ключу, а метка времени — ко времени: старый перехваченный state не
 * сработает.
 */
export function signState(payload: string, now = Date.now()): string {
    const body = `${now}.${payload}`;
    const mac = createHash('sha256').update(`${body}.${process.env[KEY_ENV] ?? ''}`).digest('base64url');
    return `${body}.${mac}`;
}

const STATE_TTL_MS = 15 * 60 * 1000;

export function verifyState(state: string, now = Date.now()): string | null {
    const parts = (state || '').split('.');
    if (parts.length !== 3) return null;
    const [issuedAt, payload, mac] = parts;

    const expected = createHash('sha256')
        .update(`${issuedAt}.${payload}.${process.env[KEY_ENV] ?? ''}`)
        .digest('base64url');

    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    // Сравнение постоянного времени: длины проверяем отдельно, иначе
    // timingSafeEqual бросит исключение вместо ответа «не совпало».
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const ts = Number(issuedAt);
    if (!Number.isFinite(ts) || now - ts > STATE_TTL_MS || ts > now + 60_000) return null;

    return payload;
}
