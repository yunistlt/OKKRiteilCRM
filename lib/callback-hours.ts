// Единые правила автодозвона: валидность номера и окно рабочих часов.
// Используется формой (chat), кроном (lead-catcher) и воркером (telphin-callback),
// чтобы гарантировать: мусорные номера не звонят, а ночью очередь не дёргаем.

// Только российский мобильный: 11 цифр, начинается на 79 (после нормализации 8→7).
export function isValidRuMobile(phone: string | null | undefined): boolean {
    let d = String(phone ?? '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    return d.length === 11 && d.startsWith('79');
}

// Рабочее окно автодозвона в МСК (UTC+3). Вне окна возвращает время следующего старта.
export function callbackWindow(now: Date = new Date()): { withinHours: boolean; availableAtIso?: string } {
    const startH = parseInt(process.env.TELPHIN_CALLBACK_START_HOUR || '9', 10);
    const endH = parseInt(process.env.TELPHIN_CALLBACK_END_HOUR || '21', 10);
    const mskHour = (now.getUTCHours() + 3) % 24;
    if (mskHour >= startH && mskHour < endH) return { withinHours: true };
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours((startH - 3 + 24) % 24);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return { withinHours: false, availableAtIso: next.toISOString() };
}
