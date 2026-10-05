import { supabase } from '@/utils/supabase';
import { calculatePeriod, calculateEngineerPeriod, salaryResultToCalcRow } from '@/lib/salary/engine';

// ============================================================================
// Единая точка чтения расчёта периода для ВСЕХ потребителей (список /api/salary,
// «Моя ЗП» /api/salary/my, экспорт, AI-консультант «Зарплата»).
//
// ОТКРЫТЫЙ период — считаем «на лету» из боевых данных (никакого устаревшего
// снимка): заказы, ушедшие в производство после последнего ручного пересчёта,
// сразу видны в ведомости и в раскрытии. ЗАКРЫТЫЙ период — читаем зафиксированный
// снимок salary_calc (закрытый период неизменяем).
//
// Форма строк — как у salary_calc (snake_case) через общий маппер salaryResultToCalcRow,
// поэтому все downstream-хелперы (buildTeamOrders, my-dashboard, export) работают
// одинаково независимо от источника (live/snapshot).
// ============================================================================

export type PeriodStatus = 'open' | 'closed' | 'none';

/** Строка расчёта менеджера в форме salary_calc. */
export interface CalcRow {
    period_id: number;
    manager_id: number;
    oklad: number;
    premia_zayavki: number;
    k_quality: number;
    conv_bonus: number;
    discount_bonus: number;
    duty_pay: number;
    k_team: number;
    total: number;
    margin_info: number;
    breakdown: any;
    computed_at: string;
}

/** Строка расчёта инженера-расчётчика в форме salary_engineer_calc. */
export interface EngineerCalcRow {
    period_id: number;
    item_code: string;
    scheme_code: string;
    total: number;
    breakdown: any;
    computed_at: string;
}

export interface PeriodView {
    periodId: number | null;
    status: PeriodStatus;
    closedAt: string | null;
    closedBy: string | null;
    /** true — строки посчитаны на лету (открытый период), не из снимка. */
    live: boolean;
    rows: CalcRow[];
    engineerRows: EngineerCalcRow[];
}

const EMPTY_NONE: PeriodView = {
    periodId: null,
    status: 'none',
    closedAt: null,
    closedBy: null,
    live: false,
    rows: [],
    engineerRows: [],
};

/**
 * Расчёт периода для чтения. Открытый → live-пересчёт из боевых данных (без записи
 * в БД); закрытый → снимок salary_calc/salary_engineer_calc. Если периода ещё нет —
 * status 'none' и пустые строки.
 *
 * `includeEngineers` (по умолч. true) — считать/читать строки инженеров-расчётчиков.
 * Потребители, которым инженеры не нужны («Моя ЗП», AI-консультант), передают false,
 * чтобы не гонять лишний department-wide проход на «горячем» роуте.
 */
export async function loadPeriodView(
    year: number,
    month: number,
    opts?: { includeEngineers?: boolean },
): Promise<PeriodView> {
    const includeEngineers = opts?.includeEngineers ?? true;
    const { data: periodRow } = await supabase
        .from('salary_period')
        .select('id,status,closed_at,closed_by')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

    if (!periodRow) return EMPTY_NONE;
    const periodId = periodRow.id as number;
    const base = {
        periodId,
        closedAt: (periodRow.closed_at as string) ?? null,
        closedBy: (periodRow.closed_by as string) ?? null,
    };

    // Закрытый период неизменяем — читаем зафиксированный снимок.
    if (periodRow.status === 'closed') {
        const [{ data: rows }, engRes] = await Promise.all([
            supabase.from('salary_calc').select('*').eq('period_id', periodId),
            includeEngineers
                ? supabase.from('salary_engineer_calc').select('*').eq('period_id', periodId)
                : Promise.resolve({ data: [] as EngineerCalcRow[] }),
        ]);
        return {
            ...base,
            status: 'closed',
            live: false,
            rows: (rows as CalcRow[]) ?? [],
            engineerRows: (engRes.data as EngineerCalcRow[]) ?? [],
        };
    }

    /**
     * Открытый период считаем на лету — но результат держим минуту.
     *
     * Расчёт тянет метрики по всем заказам месяца; экран «Моя зарплата»,
     * ведомость и симулятор просят одно и то же, и каждый раз считать заново
     * нет смысла. Минута — это свежесть, которой хватает: данные за период
     * меняются реже (замечание владельца 05.10.2026 — «зп за сентябрь не
     * показывает», расчёт не укладывался в лимит).
     */
    const cacheKey = `${year}-${month}-${includeEngineers ? 'e' : ''}`;
    const cached = openPeriodCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60_000) {
        return { ...base, status: 'open', live: true, rows: cached.rows, engineerRows: cached.engineerRows };
    }

    const computedAt = new Date().toISOString();
    const [calc, eng] = await Promise.all([
        calculatePeriod(year, month),
        includeEngineers ? calculateEngineerPeriod(year, month) : Promise.resolve(null),
    ]);
    const rows: CalcRow[] = calc.results.map((r) => salaryResultToCalcRow(r, periodId, computedAt));
    const engineerRows: EngineerCalcRow[] = (eng?.results ?? []).map((r) => ({
        period_id: periodId,
        item_code: r.itemCode,
        scheme_code: r.schemeCode,
        total: r.total,
        breakdown: r.breakdown,
        computed_at: computedAt,
    }));

    openPeriodCache.set(cacheKey, { at: Date.now(), rows, engineerRows });
    return { ...base, status: 'open', live: true, rows, engineerRows };
}

/** Посчитанный открытый период: ключ «год-месяц», живёт минуту. */
const openPeriodCache = new Map<string, { at: number; rows: CalcRow[]; engineerRows: EngineerCalcRow[] }>();

/** Сбросить кэш — после правки настроек мотивации или пересчёта. */
export function dropOpenPeriodCache(): void {
    openPeriodCache.clear();
}
