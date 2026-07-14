// Единые правила автодозвона: дозваниваемость номера и окно рабочих часов.
// Используется формой (chat), кроном (lead-catcher) и воркером (telphin-callback).

// Коды стран СНГ (кроме РФ/Казахстана — те под +7). Только цифры кода.
// BY, UA, MD, AM, TJ, TM, AZ, GE, KG, UZ.
const CIS_CODES = ['375', '380', '373', '374', '992', '993', '994', '995', '996', '998'];

// Принимаем телефоны только стран СНГ (РФ/Казахстан +7, Беларусь +375, Украина +380,
// Армения +374 и т.д.). Отсекаем мусор (артикулы/токены без кода страны, слишком
// короткое/длинное). Главная защита от мусора — брать номер из настоящего поля телефона
// (см. embed), это подстраховка.
export function isDialablePhone(phone: string | null | undefined): boolean {
    const d = String(phone ?? '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 12) return false;
    // РФ / Казахстан: 7|8 + 10 цифр (11), или 10 цифр без кода (моб 9 / город 3,4,8)
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return true;
    if (d.length === 10 && '9348'.includes(d[0])) return true;
    // Прочие страны СНГ — только с кодом страны
    if (CIS_CODES.some((c) => d.startsWith(c))) return true;
    return false;
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
