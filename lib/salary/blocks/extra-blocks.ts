import { z } from 'zod';
import { round2 } from '@/lib/salary/blocks/tiers';
import { fullFill, type BonusBlock, type DataFill } from '@/lib/salary/blocks/types';
import type { ManagerMetrics } from '@/lib/salary/metrics';

// ============================================================================
// Дополнительные блоки каталога (Фаза 2). Все — на реально существующих данных.
// Группа 'flat' = разовые/целевые бонусы, которые НЕ множатся К_качества/К_команды.
// ============================================================================

const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const managerRevenue = (m: ManagerMetrics) => m.countedOrders.reduce((s, o) => s + o.revenueNoVat, 0);
const dateOnly = (s?: string) => (s ? String(s).slice(0, 10) : '');

// ── План: выполнение личного плана ──────────────────────────────────────────
const planAttainment: BonusBlock<{ thresholdPct: number; bonus: number }> = {
    code: 'plan_attainment',
    name: 'Выполнение личного плана',
    methodology: 'Бонус, если факт выручки (без НДС) достигает порога % от личного плана месяца.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['plan_personal', 'revenue_no_vat'],
    paramSchema: z.object({ thresholdPct: z.number().nonnegative(), bonus: z.number().nonnegative() }),
    compute(m, p, ctx) {
        const target = ctx.personalPlanTarget;
        const fact = managerRevenue(m);
        const noPlan = target == null || target <= 0;
        const att = noPlan ? 0 : (fact / target) * 100;
        const passed = !noPlan && att >= p.thresholdPct;
        const fill: DataFill = { required: 1, present: noPlan ? 0 : 1, pct: noPlan ? 0 : 1 };
        return {
            amount: round2(passed ? p.bonus : 0),
            explain: noPlan ? 'Личный план не задан → 0' : `Факт ${rub(fact)} / план ${rub(target!)} = ${Math.round(att)}% (порог ${p.thresholdPct}%) → ${passed ? rub(p.bonus) : '0'}`,
            dataFill: fill,
        };
    },
};

// ── План: ускоритель за перевыполнение ──────────────────────────────────────
const planAccelerator: BonusBlock<{ perPercent: number }> = {
    code: 'plan_accelerator',
    name: 'Ускоритель за перевыполнение плана',
    methodology: 'За каждый % сверх 100% личного плана начисляется фиксированная ставка.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['plan_personal', 'revenue_no_vat'],
    paramSchema: z.object({ perPercent: z.number().nonnegative() }),
    compute(m, p, ctx) {
        const target = ctx.personalPlanTarget;
        const fact = managerRevenue(m);
        const noPlan = target == null || target <= 0;
        const att = noPlan ? 0 : (fact / target) * 100;
        const over = Math.max(0, att - 100);
        const amount = round2(over * p.perPercent);
        return {
            amount,
            explain: noPlan ? 'Личный план не задан → 0' : `Факт ${rub(fact)} / план ${rub(target!)} = ${Math.round(att)}%, перевыполнение ${round2(over)}% × ${rub(p.perPercent)} = ${rub(amount)}`,
            dataFill: { required: 1, present: noPlan ? 0 : 1, pct: noPlan ? 0 : 1 },
        };
    },
};

// ── План: гейт (переменная часть только при выполнении) ─────────────────────
const planGate: BonusBlock<{ thresholdPct: number }> = {
    code: 'plan_gate',
    name: 'Гейт по плану',
    methodology: 'Множитель переменной части: 1, если выполнение личного плана ≥ порога, иначе 0. План не задан → 1 (не режем).',
    kind: 'multiplier',
    group: 'variable',
    multiplierScope: 'variableBracket',
    requiredMetrics: ['plan_personal', 'revenue_no_vat'],
    paramSchema: z.object({ thresholdPct: z.number().nonnegative() }),
    compute(m, p, ctx) {
        const target = ctx.personalPlanTarget;
        const fact = managerRevenue(m);
        const noPlan = target == null || target <= 0;
        const att = noPlan ? 0 : (fact / target) * 100;
        const mult = noPlan || att >= p.thresholdPct ? 1 : 0;
        return {
            multiplier: mult,
            amount: 0,
            explain: noPlan ? 'План не задан → ×1' : `Факт ${rub(fact)} / план ${rub(target!)} = ${Math.round(att)}% (порог ${p.thresholdPct}%) → ×${mult}`,
            dataFill: { required: 1, present: noPlan ? 0 : 1, pct: noPlan ? 0 : 1 },
        };
    },
};

// ── План отдела: гейт (переменная часть только при выполнении плана отдела) ──
const departmentPlanGate: BonusBlock<{ thresholdPct: number }> = {
    code: 'department_plan_gate',
    name: 'Гейт по плану отдела',
    methodology: 'Множитель переменной части: 1, если выручка отдела (без НДС) достигает порога % от плана отдела, иначе 0. План отдела не задан → 1 (не режем).',
    kind: 'multiplier',
    group: 'variable',
    multiplierScope: 'variableBracket',
    requiredMetrics: ['plan_department', 'team_revenue'],
    paramSchema: z.object({ thresholdPct: z.number().nonnegative() }),
    compute(m, p, ctx) {
        const target = ctx.departmentPlanTarget;
        const fact = ctx.teamRevenueNoVat;
        const noPlan = target == null || target <= 0;
        const att = noPlan ? 0 : (fact / target) * 100;
        const mult = noPlan || att >= p.thresholdPct ? 1 : 0;
        return {
            multiplier: mult,
            amount: 0,
            explain: noPlan ? 'План отдела не задан → ×1' : `Факт отдела ${rub(fact)} / план отдела ${rub(target!)} = ${Math.round(att)}% (порог ${p.thresholdPct}%) → ×${mult}`,
            dataFill: { required: 1, present: noPlan ? 0 : 1, pct: noPlan ? 0 : 1 },
        };
    },
};

// ── Бонус за объём выручки ──────────────────────────────────────────────────
const volumeBonus: BonusBlock<{ threshold: number; bonus: number }> = {
    code: 'volume_bonus',
    name: 'Бонус за объём выручки',
    methodology: 'Бонус, если выручка менеджера (без НДС) за месяц достигает порога.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['revenue_no_vat'],
    paramSchema: z.object({ threshold: z.number().nonnegative(), bonus: z.number().nonnegative() }),
    compute(m, p) {
        const rev = managerRevenue(m);
        const passed = rev >= p.threshold;
        return {
            amount: round2(passed ? p.bonus : 0),
            explain: `Выручка ${rub(rev)} ${passed ? '≥' : '<'} ${rub(p.threshold)} → ${passed ? rub(p.bonus) : '0'}`,
            dataFill: fullFill(1),
        };
    },
};

// ── SPIFF: продажа в день обращения ─────────────────────────────────────────
const sameDaySale: BonusBlock<{ rate: number }> = {
    code: 'same_day_sale',
    name: 'Продажа в день обращения',
    methodology: 'За каждый заказ, переданный в производство в тот же календарный день, что и дата обращения (создания заказа), начисляется ставка.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['counted_orders', 'order_created_date'],
    paramSchema: z.object({ rate: z.number().nonnegative() }),
    compute(m, p) {
        let count = 0;
        let withDates = 0;
        for (const o of m.countedOrders) {
            if (o.createdAt && o.enteredAt) {
                withDates += 1;
                if (dateOnly(o.createdAt) === dateOnly(o.enteredAt)) count += 1;
            }
        }
        const amount = round2(count * p.rate);
        return {
            amount,
            explain: `${count} заказ(ов) в день обращения × ${rub(p.rate)} = ${rub(amount)}`,
            dataFill: { required: m.countedOrders.length, present: withDates, pct: m.countedOrders.length ? withDates / m.countedOrders.length : 1 },
        };
    },
};

// ── Качество ОКК: соблюдение скрипта ────────────────────────────────────────
const scriptBonus: BonusBlock<{ thresholdPct: number; bonus: number }> = {
    code: 'script_bonus',
    name: 'Бонус за соблюдение скрипта',
    methodology: 'Бонус, если средний % соблюдения скрипта (ОКК) за месяц ≥ порога.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['okk_script_score'],
    paramSchema: z.object({ thresholdPct: z.number().nonnegative(), bonus: z.number().nonnegative() }),
    compute(m, p) {
        const v = m.qualityScriptPct;
        const passed = v != null && v >= p.thresholdPct;
        return {
            amount: round2(passed ? p.bonus : 0),
            explain: v == null ? 'Нет оценок скрипта → 0' : `Скрипт ${Math.round(v)}% (порог ${p.thresholdPct}%) → ${passed ? rub(p.bonus) : '0'}`,
            dataFill: { required: 1, present: v != null ? 1 : 0, pct: v != null ? 1 : 0 },
        };
    },
};

// ── Качество ОКК: скорость первого контакта ─────────────────────────────────
const fastContactBonus: BonusBlock<{ thresholdPct: number; bonus: number }> = {
    code: 'fast_contact_bonus',
    name: 'Бонус за скорость первого контакта',
    methodology: 'Бонус, если доля заказов «взято в работу < 1 дня» (ОКК) ≥ порога.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['okk_first_contact'],
    paramSchema: z.object({ thresholdPct: z.number().nonnegative(), bonus: z.number().nonnegative() }),
    compute(m, p) {
        const v = m.fastContactShare;
        const passed = v != null && v >= p.thresholdPct;
        return {
            amount: round2(passed ? p.bonus : 0),
            explain: v == null ? 'Нет данных по скорости → 0' : `Быстрый контакт у ${Math.round(v)}% (порог ${p.thresholdPct}%) → ${passed ? rub(p.bonus) : '0'}`,
            dataFill: { required: 1, present: v != null ? 1 : 0, pct: v != null ? 1 : 0 },
        };
    },
};

// ── Качество ОКК: заполнение ТЗ ─────────────────────────────────────────────
const fieldsBonus: BonusBlock<{ thresholdPct: number; bonus: number }> = {
    code: 'fields_bonus',
    name: 'Бонус за заполнение ТЗ',
    methodology: 'Бонус, если доля заказов с полученным ТЗ (ОКК) ≥ порога.',
    kind: 'variable',
    group: 'flat',
    requiredMetrics: ['okk_fields_filled'],
    paramSchema: z.object({ thresholdPct: z.number().nonnegative(), bonus: z.number().nonnegative() }),
    compute(m, p) {
        const v = m.fieldsFilledShare;
        const passed = v != null && v >= p.thresholdPct;
        return {
            amount: round2(passed ? p.bonus : 0),
            explain: v == null ? 'Нет данных по ТЗ → 0' : `ТЗ получено у ${Math.round(v)}% (порог ${p.thresholdPct}%) → ${passed ? rub(p.bonus) : '0'}`,
            dataFill: { required: 1, present: v != null ? 1 : 0, pct: v != null ? 1 : 0 },
        };
    },
};

export const EXTRA_BLOCKS: BonusBlock[] = [
    planAttainment,
    planAccelerator,
    planGate,
    departmentPlanGate,
    volumeBonus,
    sameDaySale,
    scriptBonus,
    fastContactBonus,
    fieldsBonus,
];
