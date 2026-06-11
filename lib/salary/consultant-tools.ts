import { supabase } from '@/utils/supabase';

// Read-only salary tools for the "Семён" consultant (OpenAI function calling).
// Source of truth: the persisted `salary_calc` row — the SAME data the "Моя зарплата" page
// shows (app/api/salary/route.ts). No writes, salary engine untouched.
// Marginal value per order is derived from compose.ts:72 — total = base + (премия·K_качества + variable)·K_команды,
// so one extra order of a given type adds rates[type] × k_quality × k_team to the total.

export type SalaryToolContext = {
    retailCrmManagerId: number | null;
    defaultYear: number;
    defaultMonth: number;
};

type SalaryCalcRow = {
    total: number | null;
    oklad: number | null;
    premia_zayavki: number | null;
    k_quality: number | null;
    conv_bonus: number | null;
    discount_bonus: number | null;
    duty_pay: number | null;
    k_team: number | null;
    breakdown: any;
};

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const mult = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
};

async function loadManagerSalary(managerId: number, year: number, month: number): Promise<SalaryCalcRow | null> {
    const { data: periodRow } = await supabase
        .from('salary_period')
        .select('id')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

    if (!periodRow) return null;

    const { data } = await supabase
        .from('salary_calc')
        .select('total, oklad, premia_zayavki, k_quality, conv_bonus, discount_bonus, duty_pay, k_team, breakdown')
        .eq('period_id', periodRow.id)
        .eq('manager_id', managerId)
        .maybeSingle();

    return (data as SalaryCalcRow) || null;
}

function buildFacts(row: SalaryCalcRow, year: number, month: number) {
    const breakdown = row.breakdown || {};
    const rates = breakdown.rates || {};
    const counts = breakdown.counts || {};
    const kQuality = mult(row.k_quality);
    const kTeam = mult(row.k_team);
    const rateNew = num(rates.new);
    const rateOld = num(rates.permanent);

    return {
        period: { year, month },
        total: r2(num(row.total)),
        oklad: r2(num(row.oklad)),
        premiaZayavki: r2(num(row.premia_zayavki)),
        convBonus: r2(num(row.conv_bonus)),
        discountBonus: r2(num(row.discount_bonus)),
        dutyPay: r2(num(row.duty_pay)),
        kQuality,
        kTeam,
        conversionPct: num(breakdown.conversionPct),
        counts: { new: num(counts.new), permanent: num(counts.permanent), pech_vto: num(counts.pech_vto) },
        countedOrders: Array.isArray(breakdown.countedOrders) ? breakdown.countedOrders.length : num((breakdown.countedOrderIds || []).length),
        rateNewOrder: rateNew,
        rateOldOrder: rateOld,
        // Предельная прибавка к итогу за ОДНУ дополнительную заявку данного типа.
        marginalNew: r2(rateNew * kQuality * kTeam),
        marginalOld: r2(rateOld * kQuality * kTeam),
        note: 'marginalNew/Old — прибавка к итогу за одну новую/постоянную заявку (ставка×K_качества×K_команды). Конв-бонус и премия за категории считаются отдельно по порогам.',
    };
}

function ordersToReach(facts: ReturnType<typeof buildFacts>, target: number) {
    const missing = r2(target - facts.total);
    if (target <= 0) {
        return { available: true, reachable: false, reason: 'Не задана корректная целевая сумма.' };
    }
    if (missing <= 0) {
        return { available: true, target: r2(target), current: facts.total, missing: 0, message: 'Цель уже достигнута или превышена.' };
    }
    const ordersNewOnly = facts.marginalNew > 0 ? Math.ceil(missing / facts.marginalNew) : null;
    const ordersOldOnly = facts.marginalOld > 0 ? Math.ceil(missing / facts.marginalOld) : null;

    return {
        available: true,
        target: r2(target),
        current: facts.total,
        missing,
        marginalNew: facts.marginalNew,
        marginalOld: facts.marginalOld,
        ordersNewOnly,
        ordersOldOnly,
        currentConversionPct: facts.conversionPct,
        note: 'Линейная оценка по премии за заявку. Дополнительно поднять итог можно ростом конверсии (конв-бонус по порогам) и премией за категории — они здесь не учтены.',
    };
}

export const SALARY_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'get_my_salary',
            description: 'Текущий расчёт зарплаты пользователя за период (как на странице «Моя зарплата»): итого, оклад, премия за заявки, K_качества, K_команды, конверсия, число засчитанных заказов, ставки за новую/постоянную заявку и предельная прибавка за одну дополнительную заявку. Только зарплата текущего пользователя.',
            parameters: {
                type: 'object',
                properties: {
                    year: { type: 'integer', description: 'Год периода. По умолчанию текущий.' },
                    month: { type: 'integer', description: 'Месяц 1-12. По умолчанию текущий.' },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'orders_to_reach',
            description: 'Сколько ещё новых или постоянных заявок нужно закрыть текущему пользователю, чтобы достичь целевой суммы зарплаты за период.',
            parameters: {
                type: 'object',
                properties: {
                    target_total: { type: 'number', description: 'Целевая сумма зарплаты в рублях.' },
                    year: { type: 'integer' },
                    month: { type: 'integer' },
                },
                required: ['target_total'],
            },
        },
    },
];

export async function executeSalaryTool(name: string, args: any, ctx: SalaryToolContext): Promise<any> {
    if (ctx.retailCrmManagerId == null) {
        return { available: false, reason: 'У пользователя не привязан менеджер RetailCRM — персональный расчёт зарплаты недоступен.' };
    }

    // manager_id ВСЕГДА из сессии (ctx) — аргументы LLM игнорируются (приватность: только своя ЗП).
    const year = Number(args?.year) || ctx.defaultYear;
    const month = Number(args?.month) || ctx.defaultMonth;

    const row = await loadManagerSalary(ctx.retailCrmManagerId, year, month);
    if (!row) {
        return { available: false, reason: `Нет сохранённого расчёта зарплаты за ${month}.${year}.`, period: { year, month } };
    }

    const facts = buildFacts(row, year, month);

    if (name === 'get_my_salary') {
        return facts.total != null ? { available: true, ...facts } : { available: false, reason: 'Расчёт пуст.' };
    }
    if (name === 'orders_to_reach') {
        return ordersToReach(facts, num(args?.target_total));
    }
    return { available: false, reason: `Неизвестный инструмент: ${name}` };
}
