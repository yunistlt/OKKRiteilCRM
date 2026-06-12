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
// Человеческие имена метрик скидочной дисциплины (для explain — без кодов).
const DISCOUNT_METRIC_NAMES: Record<string, string> = {
    avg_order_discount_pct: 'Средневзвешенный % скидки',
    share_orders_no_discount: 'Доля заказов без скидки',
};
const discountMetricName = (code: string) => DISCOUNT_METRIC_NAMES[code] ?? code;

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

// Премия за заявку по типу клиента (новый / постоянный). Премия за категории
// товара — в отдельных блоках premia_categorii / coef_categorii (добавочно).
const premiaZayavki: BonusBlock<{ rates: { new: number; permanent: number } }> = {
    code: 'premia_zayavki',
    name: 'Премия за заявки',
    methodology: 'За каждую засчитанную заявку начисляется ставка по типу клиента (новый / постоянный). Премия = Σ количество × ставка. Премия за категории товара — в отдельном блоке «Премия за категории товаров».',
    kind: 'premia',
    group: 'premia',
    requiredMetrics: ['counted_orders', 'order_type'],
    // Zod по умолчанию отбрасывает лишние ключи → старые схемы с доп. ставками читаются без ошибки.
    paramSchema: z.object({ rates: z.object({ new: z.number().nonnegative(), permanent: z.number().nonnegative() }) }),
    compute(m, p) {
        const c = m.countsByType;
        const amount = c.new * p.rates.new + c.permanent * p.rates.permanent;
        const total = c.new + c.permanent;
        return {
            amount: round2(amount),
            explain: `Новых ${c.new}×${rub(p.rates.new)} + Постоянных ${c.permanent}×${rub(p.rates.permanent)} = ${rub(amount)}`,
            dataFill: fullFill(total),
        };
    },
};

// Премия за категории товаров (аддитивная): фикс. сумма за заявку или % от выручки.
// Категория заявки = orders.customFields.typ_castomer (одно значение на заказ).
// group: 'premia' → умножается на К_качества и К_команды (как премия за заявки).
const premiaCategorii: BonusBlock<{ rows: { category: string; mode: 'sum' | 'pct'; value: number }[] }> = {
    code: 'premia_categorii',
    name: 'Премия за категории товаров',
    methodology: 'За заявки заданных категорий товара начисляется доплата: «Сумма» — фикс. ₽ за заявку (Σ кол-во × ставка); «% от продажи» — процент от выручки без НДС по заявкам категории.',
    kind: 'premia',
    group: 'premia',
    requiredMetrics: ['counted_orders', 'category_counts', 'category_revenue'],
    // category допускает пустую строку — шаблонная строка в конструкторе до выбора категории; в расчёте пропускается.
    paramSchema: z.object({
        rows: z.array(z.object({ category: z.string(), mode: z.enum(['sum', 'pct']), value: z.number().nonnegative() })),
    }),
    compute(m, p, ctx) {
        const catName = (code: string) => ctx.categoryNames?.[code] ?? code;
        let amount = 0;
        const parts: string[] = [];
        for (const r of p.rows) {
            if (r.mode === 'sum') {
                const cnt = m.countsByCategory[r.category] ?? 0;
                if (cnt > 0) {
                    amount += cnt * r.value;
                    parts.push(`${catName(r.category)}: ${cnt}×${rub(r.value)}`);
                }
            } else {
                const rev = m.revenueByCategory[r.category] ?? 0;
                if (rev > 0) {
                    const a = (rev * r.value) / 100;
                    amount += a;
                    parts.push(`${catName(r.category)}: ${round2(r.value)}% от ${rub(rev)} = ${rub(a)}`);
                }
            }
        }
        return {
            amount: round2(amount),
            explain: parts.length ? `${parts.join(' + ')} = ${rub(amount)}` : 'Нет заявок по заданным категориям',
            dataFill: fullFill(p.rows.length),
        };
    },
};

// Коэффициент за категории товаров (множитель всей переменной части).
// Если у менеджера есть засчитанные заявки заданной категории — переменная скобка
// умножается на коэффициент. Несколько категорий перемножаются (как К_команды).
const coefCategorii: BonusBlock<{ rows: { category: string; coef: number }[] }> = {
    code: 'coef_categorii',
    name: 'Коэффициент за категории товаров',
    methodology: 'Если у менеджера есть засчитанные заявки заданной категории — вся переменная часть умножается на коэффициент. Несколько категорий перемножаются. Нет таких заявок → ×1.',
    kind: 'multiplier',
    group: 'variable',
    multiplierScope: 'variableBracket',
    requiredMetrics: ['counted_orders', 'category_counts'],
    paramSchema: z.object({
        rows: z.array(z.object({ category: z.string(), coef: z.number().nonnegative() })),
    }),
    compute(m, p, ctx) {
        const catName = (code: string) => ctx.categoryNames?.[code] ?? code;
        let mult = 1;
        const parts: string[] = [];
        for (const r of p.rows) {
            const cnt = m.countsByCategory[r.category] ?? 0;
            if (cnt > 0) {
                mult *= r.coef;
                parts.push(`${catName(r.category)} (${cnt} шт.) ×${r.coef}`);
            }
        }
        return {
            multiplier: mult,
            amount: 0,
            explain: parts.length ? parts.join(', ') : 'Нет заявок по заданным категориям → ×1',
            dataFill: fullFill(p.rows.length),
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
            explain: `${discountMetricName(p.metric)}: ${v != null ? round2(v) + '%' : '—'} ${p.comparator === 'lte' ? '≤' : '≥'} ${p.threshold} → ${passed ? rub(p.bonus) : '0 (порог не пройден)'}`,
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

export const CORE_BLOCKS: BonusBlock[] = [oklad, premiaZayavki, premiaCategorii, coefCategorii, kQuality, convBonus, discountBonus, kTeam, duty];
