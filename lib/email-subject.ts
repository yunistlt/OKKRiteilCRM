/**
 * Тема письма по заказу: служебный тег `[#N/НОМЕР]`.
 *
 * Закон проекта: номер заказа в теме обязателен и ставится автоматически —
 * руками его не пишут. Здесь только разбор и сборка темы, без почты и
 * зависимостей, чтобы этим мог пользоваться и браузер (форма ответа).
 */

/** Тема с тегом заказа — так письмо привязывается к заказу. */
export function buildOrderThreadSubject(orderNumber: string | number, text: string, seq = 1): string {
    return `[#${seq}/${orderNumber}] ${text}`.trim();
}

/** Убирает служебный тег `[#N/НОМЕР]` и цепочку Re:/Fwd: — остаётся человеческая часть. */
export function stripOrderThreadTag(subject: string): string {
    return (subject || '')
        .replace(/\[#\d+\/\d+\]/g, '')
        .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')
        .trim();
}

/** Достаёт номер заказа из служебного тега темы, иначе null. */
export function parseOrderNumberFromSubject(subject: string): string | null {
    const m = subject.match(/\[#\d+\/(\d+)\]/);
    return m ? m[1] : null;
}
