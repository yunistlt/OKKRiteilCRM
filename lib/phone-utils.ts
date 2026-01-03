/**
 * Утилиты для работы с телефонными номерами
 * Нормализация для матчинга
 */

/**
 * Нормализует телефонный номер для матчинга
 * Убирает все символы кроме цифр и +
 */
export function normalizePhone(phone: string | null | undefined): string | null {
    if (!phone) return null;

    const cleaned = String(phone).replace(/[^\d+]/g, '');

    // Если номер начинается с 8, заменяем на +7
    if (cleaned.startsWith('8') && cleaned.length === 11) {
        return '+7' + cleaned.substring(1);
    }

    // Если номер начинается с 7 (без +), добавляем +
    if (cleaned.startsWith('7') && cleaned.length === 11) {
        return '+' + cleaned;
    }

    return cleaned;
}

/**
 * Извлекает последние N цифр номера (для частичного матчинга)
 */
export function getPhoneSuffix(phone: string | null, length: number = 7): string | null {
    if (!phone) return null;
    const normalized = normalizePhone(phone);
    if (!normalized) return null;

    const digitsOnly = normalized.replace(/\D/g, '');
    return digitsOnly.slice(-length);
}

/**
 * Сравнивает два номера
 */
export function phonesMatch(phone1: string | null, phone2: string | null): boolean {
    const norm1 = normalizePhone(phone1);
    const norm2 = normalizePhone(phone2);

    if (!norm1 || !norm2) return false;
    return norm1 === norm2;
}

/**
 * Проверяет частичное совпадение (последние 7 цифр)
 */
export function phonesPartialMatch(phone1: string | null, phone2: string | null): boolean {
    const suffix1 = getPhoneSuffix(phone1, 7);
    const suffix2 = getPhoneSuffix(phone2, 7);

    if (!suffix1 || !suffix2) return false;
    return suffix1 === suffix2;
}
