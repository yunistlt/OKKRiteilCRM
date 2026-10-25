/**
 * Через сколько пробовать снова положить копию письма в «Отправленные».
 *
 * 12.10.2026 Яндекс не принимал копии семь часов, а задача сдавалась за
 * пятнадцать минут: пять попыток подряд по две минуты — и в мёртвые. 57 писем
 * клиент получил, а в почтовом ящике их не видно.
 *
 * Лестница терпит сутки: первые попытки частые (ящик бывает недоступен
 * минутами), дальше реже — быстрые повторы ограничение ящика только продлевают.
 *
 * Вынесено из воркера отдельным файлом, чтобы закрыть тестом: ошибка здесь
 * видна только через неделю и только по потерянным письмам.
 */
export const SENT_COPY_RETRY_LADDER = [120, 600, 1800, 3600, 7200, 14400, 21600, 21600, 21600];

/** Сколько ждать перед попыткой номер `attempts` (секунды). */
export function sentCopyRetryDelay(attempts: number): number {
    const safe = Number.isFinite(attempts) ? Math.floor(attempts) : 1;
    const index = Math.min(Math.max(1, safe) - 1, SENT_COPY_RETRY_LADDER.length - 1);
    return SENT_COPY_RETRY_LADDER[index];
}

/** Сколько всего терпит лестница при таком числе попыток (секунды). */
export function sentCopyPatienceSeconds(maxAttempts: number): number {
    let total = 0;
    for (let attempt = 1; attempt < Math.max(1, maxAttempts); attempt += 1) {
        total += sentCopyRetryDelay(attempt);
    }
    return total;
}
