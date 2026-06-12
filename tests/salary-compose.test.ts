/**
 * Golden-тест: блочный движок под пресетом «Продавец» обязан давать ТЕ ЖЕ числа,
 * что прежняя жёсткая формула:
 *   ЗП = Оклад + [(Премия×К_кач) + Конв + Скидка] × К_команды + Дежурства
 * Это гейт обратной совместимости рефактора на блоки.
 */
import { describe, it, expect } from 'vitest';
import { computeManagerSalary } from '@/lib/salary/engine';
import { pickTier } from '@/lib/salary/blocks/tiers';
import type { ManagerMetrics } from '@/lib/salary/metrics';
import type { BlockComputeContext, BlockInstance } from '@/lib/salary/blocks/types';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Значения = сид «Продавца» (migrations/20260610_salary_schemes.sql) = текущий salary_config.
const PECH_RATE = 3000; // ставка премии за категорию товара (тестовая категория 'pech')
const CFG = {
    oklad: 35000,
    rate_zayavka: { new: 2000, permanent: 1000 },
    k_quality_tiers: [{ min: 90, k: 1.2 }, { min: 75, k: 1.1 }, { min: 60, k: 1.0 }, { min: 40, k: 0.9 }, { min: 0, k: 0.8 }],
    conv_bonus_tiers: [{ min: 45, bonus: 9000 }, { min: 35, bonus: 6000 }, { min: 25, bonus: 3000 }, { min: 0, bonus: 0 }],
    conv_min_zayavki: 10,
    discount_bonus: { metric: 'avg_order_discount_pct', comparator: 'lte' as const, threshold: 5, bonus: 5000 },
    duty_rate: 250,
    k_team_tiers: [{ min: 20000000, k: 1.3 }, { min: 16000000, k: 1.15 }, { min: 12000000, k: 1.0 }, { min: 0, k: 0.5 }],
};

// Премия за категории товара — добавочный блок (режим «Сумма»), читает countsByCategory.
// Тестовая категория — 'pech'.
const SELLER_BLOCKS: BlockInstance[] = [
    { code: 'oklad', params: { oklad: CFG.oklad } },
    { code: 'premia_zayavki', params: { rates: { new: CFG.rate_zayavka.new, permanent: CFG.rate_zayavka.permanent } } },
    { code: 'premia_categorii', params: { rows: [{ category: 'pech', mode: 'sum', value: PECH_RATE }] } },
    { code: 'k_quality', params: { tiers: CFG.k_quality_tiers } },
    { code: 'conv_bonus', params: { tiers: CFG.conv_bonus_tiers, minZayavki: CFG.conv_min_zayavki } },
    { code: 'discount_bonus', params: CFG.discount_bonus },
    { code: 'k_team', params: { tiers: CFG.k_team_tiers } },
    { code: 'duty', params: { rate: CFG.duty_rate } },
];

// Прежняя формула — эталон ИТОГА. Печь даёт ту же премию (group premia), что и раньше,
// поэтому total совпадает; изменилась лишь раскладка по колонкам:
//   premiaZayavki (legacy) = клиентская премия (new/permanent), без печи.
function oldFormula(m: ManagerMetrics, businessDays: number, teamRev: number) {
    const r = CFG.rate_zayavka;
    const premiaClient = m.countsByType.new * r.new + m.countsByType.permanent * r.permanent;
    const premiaCategory = (m.countsByCategory.pech ?? 0) * PECH_RATE;
    const premia = premiaClient + premiaCategory;
    const kQuality = m.qualityAvgScore == null ? 1 : pickTier(m.qualityAvgScore, CFG.k_quality_tiers)?.k ?? 1;
    const convBonus = m.conversion.eligible ? pickTier(m.conversion.pct, CFG.conv_bonus_tiers)?.bonus ?? 0 : 0;
    const dv = m.discountMetricValue;
    const discountPassed = dv != null && (CFG.discount_bonus.comparator === 'lte' ? dv <= CFG.discount_bonus.threshold : dv >= CFG.discount_bonus.threshold);
    const discountBonus = discountPassed ? CFG.discount_bonus.bonus : 0;
    const okladProration = m.workedDays == null || businessDays <= 0 ? 1 : Math.min(1, m.workedDays / businessDays);
    const oklad = CFG.oklad * okladProration;
    const dutyPay = m.dutyShifts * CFG.duty_rate;
    const kTeam = pickTier(teamRev, CFG.k_team_tiers)?.k ?? 1;
    const variablePart = (premia * kQuality + convBonus + discountBonus) * kTeam;
    return { oklad: round2(oklad), premiaZayavki: round2(premiaClient), kQuality, convBonus: round2(convBonus), discountBonus: round2(discountBonus), dutyPay: round2(dutyPay), kTeam, total: round2(oklad + variablePart + dutyPay) };
}

function mkMetrics(p: Partial<ManagerMetrics>): ManagerMetrics {
    return {
        managerId: 1,
        countedOrders: [],
        countsByType: { new: 0, permanent: 0 },
        countsByCategory: {},
        revenueByCategory: {},
        discountMetricValue: null,
        qualityAvgScore: null,
        qualityScriptPct: null,
        fastContactShare: null,
        fieldsFilledShare: null,
        conversion: { numerator: 0, denominator: 0, pct: 0, eligible: false },
        dutyShifts: 0,
        workedDays: null,
        marginTotal: 0,
        ...p,
    };
}

const CASES: { name: string; m: ManagerMetrics; businessDays: number; teamRev: number }[] = [
    {
        name: 'продавец с премией, качеством, конверсией, скидкой',
        m: mkMetrics({ countsByType: { new: 11, permanent: 1 }, countsByCategory: { pech: 2 }, qualityAvgScore: 78, conversion: { numerator: 14, denominator: 30, pct: 46.7, eligible: true }, discountMetricValue: 4.2, dutyShifts: 3 }),
        businessDays: 20,
        teamRev: 8843365,
    },
    {
        name: 'нет оценок ОКК → К_кач 1, нет допуска по конверсии',
        m: mkMetrics({ countsByType: { new: 4, permanent: 0 }, countsByCategory: { pech: 8 }, qualityAvgScore: null, conversion: { numerator: 4, denominator: 8, pct: 50, eligible: false }, discountMetricValue: 10.3 }),
        businessDays: 20,
        teamRev: 8843365,
    },
    {
        name: 'оклад с пропорцией по дням + высокая выручка отдела',
        m: mkMetrics({ countsByType: { new: 7, permanent: 0 }, countsByCategory: { pech: 9 }, qualityAvgScore: 92, conversion: { numerator: 16, denominator: 35, pct: 45.7, eligible: true }, discountMetricValue: 4.96, workedDays: 15 }),
        businessDays: 21,
        teamRev: 17000000,
    },
    {
        name: 'пустой менеджер (только оклад)',
        m: mkMetrics({}),
        businessDays: 20,
        teamRev: 0,
    },
];

describe('блочный движок ≡ прежняя формула (пресет «Продавец»)', () => {
    for (const c of CASES) {
        it(c.name, () => {
            const ctx: BlockComputeContext = { year: 2026, month: 5, businessDays: c.businessDays, teamRevenueNoVat: c.teamRev, personalPlanTarget: null, departmentPlanTarget: null };
            const got = computeManagerSalary(c.m, SELLER_BLOCKS, ctx, 'seller');
            const exp = oldFormula(c.m, c.businessDays, c.teamRev);
            expect(got.oklad).toBe(exp.oklad);
            expect(got.premiaZayavki).toBe(exp.premiaZayavki);
            expect(got.kQuality).toBe(exp.kQuality);
            expect(got.convBonus).toBe(exp.convBonus);
            expect(got.discountBonus).toBe(exp.discountBonus);
            expect(got.dutyPay).toBe(exp.dutyPay);
            expect(got.kTeam).toBe(exp.kTeam);
            expect(got.total).toBe(exp.total);
        });
    }

    const baseCtx: BlockComputeContext = { year: 2026, month: 5, businessDays: 20, teamRevenueNoVat: 0, personalPlanTarget: null, departmentPlanTarget: null };
    const findContrib = (got: ReturnType<typeof computeManagerSalary>, code: string) => got.breakdown.blockContributions!.find((c) => c.code === code);

    it('premia_categorii «Сумма»: Σ кол-во × ставка', () => {
        const m = mkMetrics({ countsByCategory: { 'mufelnye-pechi': 3 } });
        const got = computeManagerSalary(m, [{ code: 'premia_categorii', params: { rows: [{ category: 'mufelnye-pechi', mode: 'sum', value: 3000 }] } }], baseCtx, 'test');
        expect(findContrib(got, 'premia_categorii')!.amount).toBe(9000);
        expect(got.total).toBe(9000);
    });

    it('premia_categorii «% от продажи»: % от выручки категории', () => {
        const m = mkMetrics({ countsByCategory: { lux: 2 }, revenueByCategory: { lux: 200000 } });
        const got = computeManagerSalary(m, [{ code: 'premia_categorii', params: { rows: [{ category: 'lux', mode: 'pct', value: 5 }] } }], baseCtx, 'test');
        expect(findContrib(got, 'premia_categorii')!.amount).toBe(10000);
        expect(got.total).toBe(10000);
    });

    it('premia_categorii: пустая/незаданная категория не начисляет', () => {
        const m = mkMetrics({ countsByCategory: { foo: 5 } });
        const got = computeManagerSalary(m, [{ code: 'premia_categorii', params: { rows: [{ category: '', mode: 'sum', value: 3000 }] } }], baseCtx, 'test');
        expect(findContrib(got, 'premia_categorii')!.amount).toBe(0);
        expect(got.total).toBe(0);
    });

    it('coef_categorii: множитель всей переменной части (есть заявки категории)', () => {
        const m = mkMetrics({ countsByType: { new: 5, permanent: 0 }, countsByCategory: { vip: 5 } });
        const blocks: BlockInstance[] = [
            { code: 'premia_zayavki', params: { rates: { new: 1000, permanent: 0 } } },
            { code: 'coef_categorii', params: { rows: [{ category: 'vip', coef: 1.5 }] } },
        ];
        const got = computeManagerSalary(m, blocks, baseCtx, 'test');
        // премия 5×1000=5000, ×коэф 1.5 (переменная скобка) = 7500
        expect(got.total).toBe(7500);
    });

    it('coef_categorii: нет заявок категории → ×1', () => {
        const m = mkMetrics({ countsByType: { new: 5, permanent: 0 }, countsByCategory: {} });
        const blocks: BlockInstance[] = [
            { code: 'premia_zayavki', params: { rates: { new: 1000, permanent: 0 } } },
            { code: 'coef_categorii', params: { rows: [{ category: 'vip', coef: 1.5 }] } },
        ];
        const got = computeManagerSalary(m, blocks, baseCtx, 'test');
        expect(got.total).toBe(5000);
    });

    it('старая схема с rates.pech_vto читается без ошибки (ключ отбрасывается)', () => {
        const m = mkMetrics({ countsByType: { new: 3, permanent: 0 } });
        const got = computeManagerSalary(m, [{ code: 'premia_zayavki', params: { rates: { new: 1000, permanent: 0 } } }], baseCtx, 'test');
        // premia_zayavki больше НЕ платит печь → только new: 3×1000 = 3000
        expect(got.premiaZayavki).toBe(3000);
        expect(got.total).toBe(3000);
    });

    it('оператор: только оклад 15 000, без переменной части', () => {
        const ctx: BlockComputeContext = { year: 2026, month: 5, businessDays: 20, teamRevenueNoVat: 8843365, personalPlanTarget: null, departmentPlanTarget: null };
        const m = mkMetrics({ countsByType: { new: 5, permanent: 0 }, qualityAvgScore: 80, conversion: { numerator: 5, denominator: 20, pct: 25, eligible: true } });
        const got = computeManagerSalary(m, [{ code: 'oklad', params: { oklad: 15000 } }], ctx, 'operator');
        expect(got.oklad).toBe(15000);
        expect(got.premiaZayavki).toBe(0);
        expect(got.convBonus).toBe(0);
        expect(got.total).toBe(15000);
    });
});
