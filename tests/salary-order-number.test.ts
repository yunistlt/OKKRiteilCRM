import { describe, it, expect } from 'vitest';
import { buildPeriodMetrics, type CountedOrderRow } from '@/lib/salary/metrics';

// Ведомость показывает НОМЕР заказа, а не его идентификатор: у заказа, заведённого
// в ОКК, номер 900072 при идентификаторе 900000072 (жалоба владельца 15.10.2026 —
// «странно нумерация идёт, лишние нули»). Имя клиента приходит из карточки клиента.
const CONFIG = {
    permanent_client_threshold: 2,
    vat_policy: { default_vat_pct: 20, exempt_sites: [], exempt_contragent_markers: [] },
    nds_normalization: { rules: [] },
    discount_bonus: { metric: 'avg_order_discount_pct' },
    conv_min_zayavki: 1,
} as any;

function row(over: Partial<CountedOrderRow>): CountedOrderRow {
    return {
        order_id: 900000072,
        number: '900072',
        manager_id: 98,
        client_id: 1324134775,
        client_name: 'АО "Мордовская электросетевая компания"',
        entered_at: '2026-10-06T09:00:00Z',
        totalsumm: 88567.82,
        order_method: null,
        typ_castomer: null,
        created_at: '2026-10-06T09:00:00Z',
        site: 'zmktlt-ru',
        items: [],
        contragent: null,
        ...over,
    };
}

const metrics = (rows: CountedOrderRow[]) =>
    buildPeriodMetrics({
        year: 2026,
        month: 10,
        rows,
        clientDeals: new Map(),
        incomingByManager: new Map(),
        qualityByManager: new Map(),
        dutyByManager: new Map(),
        config: CONFIG,
    });

describe('заказ в ведомости ЗП', () => {
    it('несёт номер заказа отдельно от идентификатора', () => {
        const order = metrics([row({})]).managers[0].countedOrders[0];
        expect(order.orderId).toBe(900000072);
        expect(order.number).toBe('900072');
    });

    it('несёт имя клиента', () => {
        const order = metrics([row({})]).managers[0].countedOrders[0];
        expect(order.clientName).toBe('АО "Мордовская электросетевая компания"');
    });

    it('без номера (старый расчёт) не падает', () => {
        const order = metrics([row({ number: null })]).managers[0].countedOrders[0];
        expect(order.number).toBeNull();
    });
});
