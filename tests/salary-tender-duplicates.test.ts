/**
 * Правило «Дубль на тендер»: сходство по составу товара вместо равенства сумм.
 * Кейсы — реальные заказы из разбора ОКК за июль 2026 (менеджер Матвеева),
 * данные упрощены до полей, которые читает правило.
 */
import { describe, it, expect } from 'vitest';
import {
    evaluateDuplicate,
    isNotOurProduct,
    isTenderDuplicate,
    itemsIntersect,
    orderItemKeys,
    resolveDuplicateRoot,
    type DuplicateContext,
    type DuplicateOrderInput,
    type NotOurProductRule,
    type ReferencedOrder,
    type TenderDuplicateRule,
} from '@/lib/salary/tender-duplicates';

// Значения = сид миграции 20260729_salary_duplicate_by_items.sql.
const RULE: TenderDuplicateRule = {
    duplicate_status: 'dubl-na-tender',
    reference_statuses: ['tender', 'ozhidanie-vykhoda-tendera'],
    duplicate_cancel_reasons: ['tender-dubl'],
};
const NOT_OUR: NotOurProductRule = {
    statuses: ['net-takikh-pozitsii'],
    cancel_reasons: ['u-nas-net-takih-pozitsij'],
};
const CTX: DuplicateContext = { rule: RULE, referenceStatusLabel: 'Тендер / Ожидание выхода тендера' };

const item = (article: string, quantity: number, initialPrice: number) => ({
    offer: { article },
    quantity,
    initialPrice,
});

/** Заказ-эталон из позиций (номер + статус + комментарий). */
function ref(params: {
    number: string;
    status: string;
    items: any[];
    managerComment?: string;
    cancelReason?: string | null;
    wonProduction?: boolean;
}): ReferencedOrder {
    return {
        number: params.number,
        status: params.status,
        cancelReason: params.cancelReason ?? null,
        managerComment: params.managerComment ?? null,
        itemKeys: orderItemKeys({ items: params.items }),
        wonProduction: params.wonProduction ?? false,
    };
}

/** Заказ-дубль. */
function dup(params: {
    status?: string;
    items: any[];
    managerComment: string;
    cancelReason?: string | null;
}): DuplicateOrderInput {
    return {
        status: params.status ?? 'dubl-na-tender',
        cancelReason: params.cancelReason ?? null,
        managerComment: params.managerComment,
        itemKeys: orderItemKeys({ items: params.items }),
    };
}

const roots = (...list: ReferencedOrder[]) => new Map(list.map((r) => [r.number, r]));

describe('состав позиций', () => {
    it('артикул нормализуется по регистру и пробелам', () => {
        const a = orderItemKeys({ items: [item('  ШС.ШСО.9.1980.1200.640 ', 1, 100)] });
        const b = orderItemKeys({ items: [item('шс.шсо.9.1980.1200.640', 1, 999)] });
        expect(itemsIntersect(a, b)).toBe(true);
    });

    it('позиция без артикула не даёт совпадения', () => {
        const a = orderItemKeys({ items: [{ offer: {}, quantity: 5, initialPrice: 100 }] });
        const b = orderItemKeys({ items: [{ offer: { article: '' }, quantity: 5, initialPrice: 100 }] });
        expect(a.size).toBe(0);
        expect(itemsIntersect(a, b)).toBe(false);
    });

    it('количество обязано совпадать', () => {
        const a = orderItemKeys({ items: [item('49084', 5, 116843)] });
        const b = orderItemKeys({ items: [item('49084', 4, 116843)] });
        expect(itemsIntersect(a, b)).toBe(false);
    });
});

describe('дубль на тендер — кейсы разбора ОКК', () => {
    // 53686: шкафы СКС + ШСО + отдельная строка «Доставка».
    const ORDER_53686 = ref({
        number: '53686',
        status: 'ozhidanie-vykhoda-tendera',
        items: [item('49084', 5, 116843), item('ШС.ШСО.9.1980.1200.640', 1, 114669), item('Доставка', 1, 168300)],
    });

    it('53827: считали без доставки — раньше учитывался из-за сумм, теперь исключён', () => {
        const order = dup({
            managerComment: '14.07. дубль 53686',
            items: [item('49084', 5, 116843), item('ШС.ШСО.9.1980.1200.640', 1, 114669)],
        });
        const v = evaluateDuplicate(order, ORDER_53686, CTX);
        expect(v.excluded).toBe(true);
        expect(v.referencedNumber).toBe('53686');
    });

    it('53977: расхождение в 1 ₽ на позицию больше не мешает', () => {
        const order = dup({ managerComment: 'дубль  53686', items: [item('49084', 5, 116842)] });
        expect(evaluateDuplicate(order, ORDER_53686, CTX).excluded).toBe(true);
    });

    it('53722: у дубля есть лишняя позиция — общей хватает', () => {
        const order = dup({
            managerComment: '6.07.\r\nдубль  53686',
            items: [item('ШС.ШСО.9.1980.1200.640', 1, 114669), item('49084', 5, 116843), item('ШС.БУР.2.1985.1950.850.600', 9, 63830)],
        });
        expect(evaluateDuplicate(order, ORDER_53686, CTX).excluded).toBe(true);
    });

    it('53746: тендер разбит по лотам — у эталона 2 позиции, у дубля 1', () => {
        const ORDER_53745 = ref({
            number: '53745',
            status: 'tender',
            items: [item('СШ.РШС.01.И.1900.1700.670(с)', 4, 175395), item('49893', 5, 61665)],
        });
        const order = dup({
            managerComment: '7.07.\r\nПопросила БЕЗ НДС\r\nдубль 53745, Татарстан, Бугульма',
            items: [item('СШ.РШС.01.И.1900.1700.670(с)', 4, 175395)],
        });
        expect(evaluateDuplicate(order, ORDER_53745, CTX).excluded).toBe(true);
    });

    it('53929: дубль отменён — ловим по причине отмены, а не по статусу', () => {
        const ORDER_53681 = ref({
            number: '53681',
            status: 'ozhidanie-vykhoda-tendera',
            items: [item('РШС-3Д-100', 8, 275051)],
        });
        const order = dup({
            status: 'soglasovanie-otmeny',
            cancelReason: 'tender-dubl',
            managerComment: 'дубль 53681',
            items: [item('РШС-3Д-100', 8, 275051)],
        });
        expect(isTenderDuplicate(order, RULE)).toBe(true);
        expect(evaluateDuplicate(order, ORDER_53681, CTX).excluded).toBe(true);
    });

    it('53693: товар другой (разобранный шкаф против собранного) — остаётся учтён', () => {
        const ORDER_53058 = ref({
            number: '53058',
            status: 'tender',
            items: [item('ШС.ШСО.32М.600.2065.650.512', 7, 46310)],
        });
        const order = dup({
            managerComment: 'дубль 53058',
            items: [item('ШСО-32м-600 ЗМК Комфорт разобранный', 7, 57641)],
        });
        const v = evaluateDuplicate(order, ORDER_53058, CTX);
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('ни один товар не совпадает');
    });

    it('53755: эталон уехал в «Отложено» — остаётся учтён', () => {
        const ORDER_53713 = ref({
            number: '53713',
            status: 'otlozeno',
            items: [item('СССЛ1.ВЭ.Д.20.1600.600.600', 1, 60532)],
        });
        const order = dup({
            managerComment: 'дубль 53713',
            items: [item('СССЛ1.ВЭ.Д.20.1600.600.600', 1, 60532)],
        });
        const v = evaluateDuplicate(order, ORDER_53713, CTX);
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('Тендер / Ожидание выхода тендера');
    });

    it('53757 / 53761: эталон 53760 выиграл тендер — дубли исключены, товар опознан по xmlId', () => {
        // В каталоге две карточки одной номенклатуры: у 53760 артикул человеческий,
        // у дублей — числовой код. Общий признак — xmlId и количество.
        const XML = '205fe40a-c659-4bcb-a566-569a963aff6e';
        const ORDER_53760 = ref({
            number: '53760',
            status: 'send-assembling',
            wonProduction: true,
            items: [{ offer: { xmlId: XML, article: 'СССЛ2.ЛП.МД.50.2000.1730.500', externalId: '34733' }, quantity: 1 }],
        });
        const order = dup({
            status: 'soglasovanie-otmeny',
            cancelReason: 'tender-dubl',
            managerComment: 'дубль 53760\r\n10.07. Закупку забрал заказ 53760. Отмена, дубль на тендер',
            items: [{ offer: { xmlId: XML, article: '49407', externalId: '49407' }, quantity: 1 }],
        });
        expect(evaluateDuplicate(order, ORDER_53760, CTX).excluded).toBe(true);
    });

    it('разные карточки разных товаров не совпадают, даже если внешний код похож', () => {
        const other = ref({
            number: '53759',
            status: 'tender',
            items: [{ offer: { xmlId: 'aaaa', article: 'A-1', externalId: '111' }, quantity: 1 }],
        });
        const order = dup({
            managerComment: 'дубль 53759',
            items: [{ offer: { xmlId: 'bbbb', article: 'B-1', externalId: '222' }, quantity: 1 }],
        });
        expect(evaluateDuplicate(order, other, CTX).excluded).toBe(false);
    });

    it('эталон в отмене и в производстве не был — дубль остаётся учтён', () => {
        const cancelled = ref({ number: '53684', status: 'soglasovanie-otmeny', items: [item('X-1', 1, 10)] });
        const v = evaluateDuplicate(dup({ managerComment: 'дубль 53684', items: [item('X-1', 1, 10)] }), cancelled, CTX);
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('не передан в производство');
    });

    it('53861: номер эталона не указан — остаётся учтён', () => {
        const order = dup({ managerComment: 'просто комментарий без номера', items: [item('РШС-3Д-100', 8, 275051)] });
        const v = evaluateDuplicate(order, null, CTX);
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('не указан номер заказа-эталона');
    });

    it('заказ не помечен дублем — правило не применяется', () => {
        const order = dup({ status: 'tender', managerComment: 'дубль 53686', items: [item('49084', 5, 116843)] });
        const v = evaluateDuplicate(order, ORDER_53686, CTX);
        expect(v.isDuplicate).toBe(false);
        expect(v.reason).toBeNull();
    });
});

describe('цепочка дублей', () => {
    // 53886 → 53873 (сам дубль) → 53478 (первоисточник в «Ожидании выхода тендера»).
    const ORDER_53478 = ref({ number: '53478', status: 'ozhidanie-vykhoda-tendera', items: [item('РШС-8Э-160', 2, 255640)] });
    const ORDER_53873 = ref({
        number: '53873',
        status: 'dubl-na-tender',
        managerComment: 'дубль 53478',
        items: [item('РШС-8Э-160', 2, 255640)],
    });

    it('разворачивается до первоисточника и дубль исключается', () => {
        const byNumber = roots(ORDER_53478, ORDER_53873);
        const root = resolveDuplicateRoot(ORDER_53873, byNumber, RULE);
        expect(root.number).toBe('53478');

        const order = dup({ managerComment: 'дубль 53873', items: [item('РШС-8Э-160', 2, 255640)] });
        const v = evaluateDuplicate(order, root, CTX);
        expect(v.excluded).toBe(true);
        expect(v.reason).toContain('первоисточник №53478');
    });

    it('в причине «учтён» называется первоисточник, а не промежуточный дубль', () => {
        const rootOtlozeno = ref({ number: '51369', status: 'otlozeno', items: [item('X-1', 1, 10)] });
        const middle = ref({
            number: '53777',
            status: 'dubl-na-tender',
            managerComment: 'дубль 51369',
            items: [item('X-1', 1, 10)],
        });
        const root = resolveDuplicateRoot(middle, roots(rootOtlozeno, middle), RULE);
        const v = evaluateDuplicate(dup({ managerComment: 'дубль 53777', items: [item('X-1', 1, 10)] }), root, CTX);
        expect(v.excluded).toBe(false);
        expect(v.reason).toContain('первоисточник №51369 (через дубль №53777)');
    });

    it('цикл не зацикливает разворот', () => {
        const a = ref({ number: '100', status: 'dubl-na-tender', managerComment: 'дубль 200', items: [] });
        const b = ref({ number: '200', status: 'dubl-na-tender', managerComment: 'дубль 100', items: [] });
        expect(resolveDuplicateRoot(a, roots(a, b), RULE).number).toBe('200');
    });

    it('оборванная цепочка возвращает последний известный заказ', () => {
        const a = ref({ number: '100', status: 'dubl-na-tender', managerComment: 'дубль 999', items: [] });
        expect(resolveDuplicateRoot(a, roots(a), RULE).number).toBe('100');
    });
});

describe('не наша продукция', () => {
    it('53842: ловится по статусу «Нет таких позиций»', () => {
        expect(isNotOurProduct({ status: 'net-takikh-pozitsii', cancelReason: 'u-nas-net-takih-pozitsij' }, NOT_OUR)).toBe(true);
    });

    it('53700 / 53714: висят в «Согласовании отмены» — ловятся по причине отмены', () => {
        expect(isNotOurProduct({ status: 'soglasovanie-otmeny', cancelReason: 'u-nas-net-takih-pozitsij' }, NOT_OUR)).toBe(true);
    });

    it('обычная отмена по цене не считается «не нашей продукцией»', () => {
        expect(isNotOurProduct({ status: 'soglasovanie-otmeny', cancelReason: 'ne-ustroila-tsena' }, NOT_OUR)).toBe(false);
        expect(isNotOurProduct({ status: 'tender', cancelReason: null }, NOT_OUR)).toBe(false);
    });
});
