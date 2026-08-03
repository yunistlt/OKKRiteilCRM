import { describe, it, expect } from 'vitest';
import { getBlock } from '@/lib/salary/blocks/registry';
import type { BlockComputeContext } from '@/lib/salary/blocks/types';
import type { CountedOrder, ManagerMetrics } from '@/lib/salary/metrics';

const block = getBlock('repeat_client_bonus')!;

const CTX: BlockComputeContext = {
    year: 2026,
    month: 8,
    businessDays: 21,
    teamRevenueNoVat: 0,
    personalPlanTarget: null,
    departmentPlanTarget: null,
    managerGrade: null,
};

// Пороги как в дефолте конструктора: 3-я покупка 10 000 ₽, 6-я 15 000 ₽.
const PARAMS = { tiers: [{ ordinal: 3, bonus: 10000 }, { ordinal: 6, bonus: 15000 }], minDaysBetween: 14 };

let seq = 0;
function order(clientOrdinal: number | null, daysSincePrevPurchase: number | null): CountedOrder {
    seq += 1;
    return {
        orderId: seq,
        managerId: 1,
        clientId: 100 + seq,
        clientName: null,
        deals: 0,
        type: 'new',
        category: null,
        enteredAt: '2026-08-10T00:00:00Z',
        createdAt: '2026-08-01T00:00:00Z',
        totalsumm: 500000,
        clientOrdinal,
        daysSincePrevPurchase,
        goodsBase: 0,
        discountAmount: 0,
        discountPct: 0,
        revenueNoVat: 0,
        margin: 0,
    };
}

function metrics(countedOrders: CountedOrder[]): ManagerMetrics {
    return {
        managerId: 1,
        countedOrders,
        countsByType: { new: 0, permanent: 0 },
        countsByCategory: {},
        revenueByCategory: {},
        discountMetricValue: null,
        qualityAvgScore: null,
        qualityScriptPct: null,
        fastContactShare: null,
        fieldsFilledShare: null,
        conversion: { numerator: 0, denominator: 0, pct: 0, eligible: false },
        workedDays: null,
        marginTotal: 0,
    };
}

const run = (orders: CountedOrder[], params = PARAMS) => block.compute(metrics(orders), params, CTX);

describe('Доплата за повторную покупку', () => {
    it('платит за покупку из списка', () => {
        expect(run([order(3, 120)]).amount).toBe(10000);
        expect(run([order(6, 90)]).amount).toBe(15000);
    });

    it('не платит за покупки вне списка', () => {
        // 1-я, 2-я, 4-я не заданы в порогах — доплаты нет.
        expect(run([order(1, null), order(2, 60), order(4, 30)]).amount).toBe(0);
    });

    it('суммирует несколько сработавших покупок за месяц', () => {
        const r = run([order(3, 120), order(3, 200), order(6, 90)]);
        expect(r.amount).toBe(35000);
        expect(r.explain).toContain('2×3-я покупка');
    });

    it('отсекает дробление: покупка раньше минимального разрыва не платится', () => {
        // Реальный кейс: три накладные одним днём дают «постоянного клиента» даром.
        const r = run([order(3, 0)]);
        expect(r.amount).toBe(0);
        expect(r.explain).toContain('малого разрыва');
    });

    it('на границе разрыва покупка засчитывается', () => {
        expect(run([order(3, 14)]).amount).toBe(10000);
        expect(run([order(3, 13.9)]).amount).toBe(0);
    });

    it('при нулевом разрыве в настройках проверка не применяется', () => {
        const r = run([order(3, 0)], { ...PARAMS, minDaysBetween: 0 });
        expect(r.amount).toBe(10000);
    });

    it('заказ без клиента не ломает расчёт и виден в заполненности данных', () => {
        const r = run([order(null, null), order(3, 120)]);
        expect(r.amount).toBe(10000);
        expect(r.dataFill).toEqual({ required: 2, present: 1, pct: 0.5 });
    });

    it('пустой список порогов = блок ничего не начисляет', () => {
        const r = run([order(3, 120)], { tiers: [], minDaysBetween: 14 });
        expect(r.amount).toBe(0);
    });

    it('бизнес может назначить доплату за любую покупку, включая 2-ю', () => {
        const r = run([order(2, 45)], { tiers: [{ ordinal: 2, bonus: 3000 }], minDaysBetween: 14 });
        expect(r.amount).toBe(3000);
        expect(r.tariff?.[0].label).toBe('За 2-ю покупку клиента');
    });

    it('схема параметров отвергает нулевой и дробный номер покупки', () => {
        expect(block.paramSchema.safeParse({ tiers: [{ ordinal: 0, bonus: 100 }], minDaysBetween: 0 }).success).toBe(false);
        expect(block.paramSchema.safeParse({ tiers: [{ ordinal: 2.5, bonus: 100 }], minDaysBetween: 0 }).success).toBe(false);
        expect(block.paramSchema.safeParse(PARAMS).success).toBe(true);
    });
});
