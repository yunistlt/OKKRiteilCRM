import { z } from 'zod';
import { supabase } from '@/utils/supabase';

// ============================================================================
// Конфиг-слой зарплатного модуля. ВСЕ параметры мотивации живут в salary_config
// (effective-dated), здесь — типобезопасное чтение «на период» + запись версии
// с аудитом. Ни одного зашитого числа мотивации в коде. См. docs/salary/PLAN.md.
// ============================================================================

const tierK = z.object({ min: z.number(), k: z.number() });
const tierBonus = z.object({ min: z.number(), bonus: z.number() });

// Zod-схема на каждый ключ конфига (типобезопасность вместо БД-констрейнтов).
export const SALARY_CONFIG_SCHEMAS = {
    oklad: z.number().nonnegative(),
    rate_zayavka: z.object({
        new: z.number().nonnegative(),
        permanent: z.number().nonnegative(),
    }),
    k_quality_tiers: z.array(tierK).min(1),
    conv_bonus_tiers: z.array(tierBonus).min(1),
    conv_min_zayavki: z.number().int().nonnegative(),
    discount_bonus: z.object({
        metric: z.string().min(1),
        comparator: z.enum(['lte', 'gte']),
        threshold: z.number(),
        bonus: z.number().nonnegative(),
    }),
    duty_rate: z.number().nonnegative(),
    k_team_tiers: z.array(tierK).min(1),
    closing_status: z.object({ code: z.string().min(1) }),
    permanent_client_threshold: z.number().int().nonnegative(),
    source_exclusions: z.array(z.string()),
    nds_normalization: z.object({
        rules: z.array(z.object({ vat_pct: z.number(), divisor: z.number().positive() })),
    }),
} as const;

export type SalaryConfigKey = keyof typeof SALARY_CONFIG_SCHEMAS;
export type SalaryConfig = {
    [K in SalaryConfigKey]: z.infer<(typeof SALARY_CONFIG_SCHEMAS)[K]>;
};

export const SALARY_CONFIG_KEYS = Object.keys(SALARY_CONFIG_SCHEMAS) as SalaryConfigKey[];

function isConfigKey(key: string): key is SalaryConfigKey {
    return key in SALARY_CONFIG_SCHEMAS;
}

/** Валидирует значение ключа по его Zod-схеме. Бросает с понятным контекстом. */
export function validateConfigValue<K extends SalaryConfigKey>(key: K, value: unknown): SalaryConfig[K] {
    const schema = SALARY_CONFIG_SCHEMAS[key] as unknown as z.ZodType<SalaryConfig[K]>;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new Error(`Некорректное значение конфига «${key}»: ${parsed.error.message}`);
    }
    return parsed.data;
}

type RawRow = { key: string; value: unknown; effective_from: string };

/**
 * Резолвит конфиг «на дату»: для каждого ключа берёт последнюю версию,
 * у которой effective_from <= asOf. Бросает, если какой-то ключ не задан
 * (никаких заглушек — конфиг обязан быть полным к расчёту).
 */
export async function getResolvedConfig(asOf: string | Date = new Date()): Promise<SalaryConfig> {
    const asOfStr = typeof asOf === 'string' ? asOf : asOf.toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from('salary_config')
        .select('key,value,effective_from')
        .lte('effective_from', asOfStr)
        .order('effective_from', { ascending: false });
    if (error) throw error;

    const latest = new Map<string, unknown>();
    for (const row of (data as RawRow[]) ?? []) {
        if (!latest.has(row.key)) latest.set(row.key, row.value);
    }

    const result = {} as SalaryConfig;
    const missing: string[] = [];
    for (const key of SALARY_CONFIG_KEYS) {
        if (!latest.has(key)) {
            missing.push(key);
            continue;
        }
        result[key] = validateConfigValue(key, latest.get(key)) as never;
    }
    if (missing.length) {
        throw new Error(
            `Конфиг ЗП не задан для ключей на дату ${asOfStr}: ${missing.join(', ')}. Заполните в настройках до расчёта.`,
        );
    }
    return result;
}

/** Конфиг на расчётный месяц (asOf = первый день месяца). */
export function getConfigForPeriod(year: number, month: number): Promise<SalaryConfig> {
    const asOf = `${year}-${String(month).padStart(2, '0')}-01`;
    return getResolvedConfig(asOf);
}

/** Текущее (effective сегодня) значение одного ключа — для аудита перед записью. */
async function getCurrentValue(key: SalaryConfigKey, asOf: string): Promise<unknown | null> {
    const { data } = await supabase
        .from('salary_config')
        .select('value')
        .eq('key', key)
        .lte('effective_from', asOf)
        .order('effective_from', { ascending: false })
        .limit(1);
    return data?.[0]?.value ?? null;
}

/**
 * Пишет новую версию ключа конфига (effective с указанной даты) + аудит.
 * Значение валидируется по Zod-схеме до записи.
 */
export async function updateConfig(params: {
    key: string;
    value: unknown;
    effectiveFrom: string; // YYYY-MM-DD
    actor: string | null;
    note?: string;
}): Promise<void> {
    const { key, value, effectiveFrom, actor, note } = params;
    if (!isConfigKey(key)) {
        throw new Error(`Неизвестный ключ конфига ЗП: ${key}`);
    }
    const validated = validateConfigValue(key, value);
    const oldValue = await getCurrentValue(key, effectiveFrom);

    const { error } = await supabase
        .from('salary_config')
        .upsert(
            { key, value: validated, effective_from: effectiveFrom, note: note ?? null, created_by: actor },
            { onConflict: 'key,effective_from' },
        );
    if (error) throw error;

    await supabase.from('salary_audit_log').insert({
        entity: 'config',
        entity_id: key,
        action: 'update',
        actor,
        old_value: oldValue ?? null,
        new_value: validated,
    });
}

/** История версий ключа (для UI «кто/когда/что менял»). */
export async function listConfigHistory(key?: string) {
    let query = supabase
        .from('salary_config')
        .select('key,value,effective_from,note,created_by,created_at')
        .order('effective_from', { ascending: false });
    if (key) query = query.eq('key', key);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
}
