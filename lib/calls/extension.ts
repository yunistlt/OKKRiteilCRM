/**
 * Чей это добавочный — по записи звонка Телфина.
 *
 * У исходящего звонка добавочный стоит прямо в «от кого»: `12037*119`. У
 * входящего там номер клиента, а отвечавший сотрудник виден только в ногах
 * разговора (`cdr`): `extension_name: "12037*104@corp.telphin.ru"`. Очередь
 * даёт несколько ног — берём ту, где разговор состоялся (закон «ноги звонка и
 * владелец заказа»).
 */

/** Добавочный из строки вида `12037*119` или `12037*104@corp.telphin.ru`. */
export function extensionFrom(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!text.includes('*')) return '';

    const tail = text.split('*')[1] ?? '';
    const digits = tail.split('@')[0].trim();
    return /^\d{2,6}$/.test(digits) ? digits : '';
}

/**
 * Кто из наших говорил в звонке: добавочный или пусто, если наших нет.
 *
 * У входящего из очереди девять ног: сценарий (`ivr`), звонки всем телефонам
 * отдела и сам разговор. Трубку взял тот, у кого нога `answered` с ненулевой
 * длительностью и типом `phone`; у остальных стоит `answered elsewhere` —
 * «ответили не у меня». Брать первую попавшуюся ногу нельзя: там добавочный
 * сценария (104), и менеджера в списке не было вовсе.
 */
export function callExtension(row: {
    direction?: string | null;
    raw_payload?: any;
}): string {
    const payload = row?.raw_payload ?? {};

    if (String(row?.direction) === 'outgoing') {
        return extensionFrom(payload.from_username);
    }

    const legs: any[] = Array.isArray(payload.cdr) ? payload.cdr : [];

    /**
     * Нога, где разговор состоялся: `answered` с ненулевой длительностью и
     * типом `phone`. У остальных стоит `answered elsewhere` — «ответили не у
     * меня», а ноги сценария идут типом `ivr`.
     */
    const talked = legs.filter((leg) =>
        String(leg?.result ?? '').toLowerCase() === 'answered'
        && Number(leg?.duration ?? 0) > 0
        && String(leg?.extension_type ?? '') === 'phone');

    /**
     * На ноге перевода `extension_name` — это сценарий (104), а человек стоит
     * в «кому перевели». Поэтому порядок разный: перевод читаем по `dest`,
     * свою ногу — по `extension_name`.
     */
    for (const leg of talked) {
        const isTransfer = String(leg?.flow ?? '').toLowerCase() === 'transfer';
        const found = isTransfer
            ? (extensionFrom(leg.dest_number) || extensionFrom(leg.to_username))
            : (extensionFrom(leg.extension_name) || extensionFrom(leg.to_username));
        if (found) return found;
    }

    // Никто не взял трубку: показываем, кому звонили, а не сценарий.
    for (const leg of legs) {
        const found = extensionFrom(leg?.dest_number) || extensionFrom(leg?.to_username);
        if (found) return found;
    }

    return '';
}
