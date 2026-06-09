import { z } from 'zod';
import { pickTier, round2 } from '@/lib/salary/blocks/tiers';
import { fullFill, type BonusBlock } from '@/lib/salary/blocks/types';

// ============================================================================
// Ядровые блоки (Фаза 1). В сумме под пресетом «Продавец» воспроизводят текущую
// формулу: oklad + (premia×К_кач + conv + discount)×К_команды + duty.
// Все ставки/тиры/пороги — в params (из БД). Здесь только метод расчёта.
// ============================================================================

const tierK = z.object({ min: z.number(), k: z.number() });
const tierBonus = z.object({ min: z.number(), bonus: z.number() });
const rub = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';

// Оклад (база). Пропорция по отработанным дням, если табель вёлся.
const oklad: BonusBlock<{ oklad: number; prorate?: boolean }> = {
    code: 'oklad',
    name: 'Оклад',
    methodology: 'Фиксированный оклад за месяц. Если ведётся табель — пропорционально отработанным дням (отработано / рабочих дней), иначе полностью.',
    kind: 'base',
    group: 'base',
    requiredMetrics: ['worked_days'],
    paramSchema: z.object({ oklad: z.number().nonnegative(), prorate: z.boolean().optional() }),
    compute(m, p, ctx) {
        const proration = p.prorate !== false && m.workedDays != null && ctx.businessDays > 0 ? Math.min(1, m.workedDays / ctx.businessDays) : 1;
        const amount = round2(p.oklad * proration);
        return {
            amount,
            explain: proration < 1 ? `Оклад ${rub(p.oklad)} × ${Math.round(proration * 100)}% дней = ${rub(amount)}` : `Оклад ${rub(p.oklad)}`,
            dataFill: { required: 1, present: m.workedDays != null ? 1 : 1, pct: 1 },
        };
    },
};

// Премия за заявку по типу.
const premiaZayavki: BonusBlock<{ rates: { new: number; permanent: number; pech_vto: number } }> = {
    code: 'premia_zayavki',
    name: 'Премия за заявки',
    methodology: 'За каждую засчитанную заявку начисляется ставка по её типу (новый / постоянный / печь-ВТО). Премия = Σ количество × ставка.',
    kind: 'premia',
    group: 'premia',
    requiredMetrics: ['counted_orders', 'order_type'],
    paramSchema: z.object({ rates: z.object({ new: z.number().nonnegative(), permanent: z.number().nonnegative(), pech_vto: z.number().nonnegative() }) }),
    compute(m, p) {
        const c = m.countsByType;
        const amount = c.new * p.rates.new + c.permanent * p.rates.permanent + c.pech_vto * p.rates.pech_vto;
        const total = c.new + c.permanent + c.pech_vto;
        return {
            amount: round2(amount),
            explain: `Новых ${c.new}×${rub(p.rates.new)} + Постоянных ${c.permanent}×${rub(p.rates.permanent)} + Печь/ВТО ${c.pech_vto}×${rub(p.rates.pech_vto)} = ${rub(amount)}`,
            dataFill: fullFill(total),
        };
    },
};

// К_качества — множитель премии по среднему скорингу ОКК.
const kQuality: BonusBlock<{ tiers: { min: number; k: number }[] }> = {
    code: 'k_quality',
    name: 'К_качества',
    methodology: 'Множитель премии за заявки по среднему скорингу качества ОКК. Нет оценок → ×1 (не штрафуем за отсутствие данных).',
    kind: 'multiplier',
    group: 'premia',
    multiplierScope: 'premia',
    requiredMetrics: ['okk_total_score'],
    paramSchema: z.object({ tiers: z.array(tierK).min(1) }),
    compute(m, p) {
        const mult = m.qualityAvgScore == null ? 1 : pickTier(m.qualityAvgScore, p.tiers)?.k ?? 1;
        return {
            multiplier: mult,
            amount: 0,
            explain: m.qualityAvgScore == null ? 'Нет оценок ОКК → ×1' : `Скоринг ${Math.round(m.qualityAvgScore)} → ×${mult}`,
            dataFill: { required: 1, present: m.qualityAvgScore == null ? 0 : 1, pct: m.qualityAvgScore == null ? 0 : 1 },
        };
    },
};

// Конв-бонус (gate по конверсии при минимуме входящих).
const convBonus: BonusBlock<{ tiers: { min: number; bonus: number }[]; minZayavki: number }> = {
    code: 'conv_bonus',
    name: 'Конв-бонус',
    methodology: 'Бонус по конверсии (закрытые ÷ входящие, %), если входящих не меньше минимума (защита от малого знаменателя).',
    kind: 'variable',
    group: 'variable',
    requiredMetrics: ['counted_orders', 'conversion_incoming'],
    paramSchema: z.object({ tiers: z.array(tierBonus).min(1), minZayavki: z.number().int().nonnegative() }),
    compute(m, p) {
        const eligible = m.conversion.denominator >= p.minZayavki;
        const bonus = eligible ? pickTier(m.conversion.pct, p.tiers)?.bonus ?? 0 : 0;
        return {
            amount: round2(bonus),
            explain: `Конверсия ${m.conversion.numerator}/${m.conversion.denominator} = ${round2(m.conversion.pct)}%${eligible ? '' : ' (нет допуска)'} → ${rub(bonus)}`,
            dataFill: { required: 1, present: m.conversion.denominator > 0 ? 1 : 0, pct: m.conversion.denominator > 0 ? 1 : 0 },
        };
    },
};

// Бонус за скидочную дисциплину (gross-margin discipline).
const discountBonus: BonusBlock<{ metric: string; comparator: 'lte' | 'gte'; threshold: number; bonus: number }> = {
    code: 'discount_bonus',
    name: 'Бонус за скидочную дисциплину',
    methodology: 'Бонус, если метрика скидок проходит порог (например, средневзвешенный % скидки ≤ порога).',
    kind: 'variable',
    group: 'variable',
    requiredMetrics: ['discount_pct'],
    paramSchema: z.object({ metric: z.string().min(1), comparator: z.enum(['lte', 'gte']), threshold: z.number(), bonus: z.number().nonnegative() }),
    compute(m, p) {
        const v = m.discountMetricValue;
        const passed = v != null && (p.comparator === 'lte' ? v <= p.threshold : v >= p.threshold);
        return {
            amount: round2(passed ? p.bonus : 0),
            explain: `Метрика «${p.metric}»: ${v != null ? round2(v) + '%' : '—'} ${p.comparator === 'lte' ? '≤' : '≥'} ${p.threshold} → ${passed ? rub(p.bonus) : '0 (порог не пройден)'}`,
            dataFill: { required: 1, present: v != null ? 1 : 0, pct: v != null ? 1 : 0 },
        };
    },
};

// К_команды — множитель всей переменной части по выручке отдела.
const kTeam: BonusBlock<{ tiers: { min: number; k: number }[] }> = {
    code: 'k_team',
    name: 'К_команды',
    methodology: 'Множитель всей переменной части по выручке отдела (без НДС) за месяц.',
    kind: 'multiplier',
    group: 'variable',
    multiplierScope: 'variableBracket',
    requiredMetrics: ['team_revenue'],
    paramSchema: z.object({ tiers: z.array(tierK).min(1) }),
    compute(_m, p, ctx) {
        const mult = pickTier(ctx.teamRevenueNoVat, p.tiers)?.k ?? 1;
        return {
            multiplier: mult,
            amount: 0,
            explain: `Выручка отдела ${rub(ctx.teamRevenueNoVat)} → ×${mult}`,
            dataFill: fullFill(1),
        };
    },
};

// Дежурства — не режутся множителями.
const duty: BonusBlock<{ rate: number }> = {
    code: 'duty',
    name: 'Дежурства',
    methodology: 'Оплата дежурств: количество смен × ставка за смену.',
    kind: 'base',
    group: 'duty',
    requiredMetrics: ['duty_shifts'],
    paramSchema: z.object({ rate: z.number().nonnegative() }),
    compute(m, p) {
        const amount = round2(m.dutyShifts * p.rate);
        return { amount, explain: `${m.dutyShifts} смен × ${rub(p.rate)} = ${rub(amount)}`, dataFill: fullFill(1) };
    },
};

export const CORE_BLOCKS: BonusBlock[] = [oklad, premiaZayavki, kQuality, convBonus, discountBonus, kTeam, duty];
