import { supabase } from '@/utils/supabase';

/**
 * Настройки шлюза чтения. Живут там же, где остальные настройки бота-РОПа
 * (`sales_rop_settings`) — отдельной таблицы ради шести ключей не заводим.
 *
 * Все числа — из базы, не из кода: порог чтения правят без выкатки.
 */
export type ReadGateSettings = {
    enabled: boolean;
    /** Минимум времени на документ, секунд. Ниже него не опускаемся никогда. */
    minSeconds: number;
    /** Скорость чтения, знаков в секунду: по ней считается минимум для длинных документов. */
    charsPerSecond: number;
    /** На сколько минут отсрочка открывает работу. */
    deferMinutes: number;
    /** Сколько отсрочек в сутки. */
    deferPerDay: number;
    /** Кого шлюз касается. */
    roles: string[];
};

export const READ_GATE_DEFAULTS: ReadGateSettings = {
    enabled: true,
    minSeconds: 45,
    charsPerSecond: 15,
    deferMinutes: 60,
    deferPerDay: 1,
    roles: ['manager'],
};

export async function loadReadGateSettings(): Promise<ReadGateSettings> {
    const { data } = await supabase
        .from('sales_rop_settings')
        .select('key, value')
        .like('key', 'read_gate_%');

    const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
    const num = (key: string, fallback: number) => {
        const v = Number(map.get(key));
        return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    const roles = String(map.get('read_gate_roles') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        enabled: String(map.get('read_gate_enabled') ?? 'true') === 'true',
        minSeconds: num('read_gate_min_seconds', READ_GATE_DEFAULTS.minSeconds),
        charsPerSecond: num('read_gate_chars_per_second', READ_GATE_DEFAULTS.charsPerSecond),
        deferMinutes: num('read_gate_defer_minutes', READ_GATE_DEFAULTS.deferMinutes),
        deferPerDay: num('read_gate_defer_per_day', READ_GATE_DEFAULTS.deferPerDay),
        roles: roles.length ? roles : READ_GATE_DEFAULTS.roles,
    };
}

/**
 * Сколько секунд требовать на документ.
 *
 * Для длинного документа минимума в 45 секунд мало — его физически не прочесть.
 * Считаем от объёма текста по скорости чтения, но НИКОГДА не меньше минимума:
 * короткая записка не должна открываться мгновенно.
 */
export function requiredSeconds(textLength: number, settings: ReadGateSettings): number {
    const byLength = Math.ceil(textLength / Math.max(1, settings.charsPerSecond));
    return Math.max(settings.minSeconds, byLength);
}
