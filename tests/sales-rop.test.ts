import { describe, expect, it } from 'vitest';
import { buildPlan, taskFor } from '@/lib/sales-rop/rules';
import type { PresaleOrder, Thresholds } from '@/lib/sales-rop/rules';
import { formatDiscipline, formatEvening, formatEveningHeader, formatMorning, shareOfLeads } from '@/lib/sales-rop/format';

// Бот-РОП: что попадает в утренний план и как это читается.
//
// Правила проверяются здесь, а не глазами на боевых данных, по простой причине:
// список уходит в общий чат с тегом менеджера. Лишняя строка — это публичный
// упрёк за то, чего человек не делал.

const T: Thresholds = {
    invoiceStaleDays: 2,
    dealStaleDays: 3,
    bigDealAmount: 1_000_000,
    bigDealSilenceDays: 7,
    tasksPerManager: 7,
    overdueLimitDays: 90,
    lostPerDay: 2,
};

const TODAY = '2026-08-31';

const order = (over: Partial<PresaleOrder> = {}): PresaleOrder => ({
    orderId: 1,
    number: '54132',
    client: 'ООО «Техномакс»',
    statusCode: 'otlozeno',
    statusName: 'Отложено',
    amount: 500_000,
    managerId: 249,
    contactDate: null,
    lastTouchAt: '2026-08-30',
    ...over,
});

describe('что попадает в план', () => {
    it('счёт без оплаты дольше порога', () => {
        const t = taskFor(order({ statusCode: 'prepayed', statusName: 'Счет на оплате', lastTouchAt: '2026-08-28' }), TODAY, T);
        expect(t?.reasonCode).toBe('invoice_stale');
        expect(t?.reasonText).toContain('3 дня');
    });

    it('свежий счёт не дёргаем', () => {
        expect(taskFor(order({ statusCode: 'prepayed', lastTouchAt: '2026-08-30' }), TODAY, T)).toBeNull();
    });

    it('просроченное обещание перезвонить', () => {
        const t = taskFor(order({ contactDate: '2026-08-20' }), TODAY, T);
        expect(t?.reasonCode).toBe('contact_overdue');
        expect(t?.reasonText).toContain('11 дней');
    });

    it('обещание старше границы — потеряшка, а не задача на сегодня', () => {
        const t = taskFor(order({ contactDate: '2023-06-01' }), TODAY, T);
        expect(t?.reasonCode).toBe('lost');
    });

    it('контакт назначен на сегодня', () => {
        expect(taskFor(order({ contactDate: TODAY }), TODAY, T)?.reasonCode).toBe('contact_today');
    });

    it('контакт в будущем — не трогаем', () => {
        expect(taskFor(order({ contactDate: '2026-09-10' }), TODAY, T)).toBeNull();
    });

    it('согласование, стоящее дольше порога', () => {
        const t = taskFor(
            order({ statusCode: 'na-soglasovanii', statusName: 'Согласование параметров заказа', lastTouchAt: '2026-08-25' }),
            TODAY,
            T,
        );
        expect(t?.reasonCode).toBe('deal_stale');
    });

    it('крупный заказ в тишине', () => {
        const t = taskFor(order({ statusCode: 'tender', amount: 5_000_000, lastTouchAt: '2026-08-01' }), TODAY, T);
        expect(t?.reasonCode).toBe('big_silence');
    });

    it('один заказ — одна задача, даже если подходит под несколько правил', () => {
        // Счёт висит И обещание просрочено: в списке должна быть одна строка.
        const t = taskFor(
            order({ statusCode: 'prepayed', lastTouchAt: '2026-08-20', contactDate: '2026-08-20' }),
            TODAY,
            T,
        );
        expect(t?.reasonCode).toBe('invoice_stale');
    });
});

describe('сборка плана', () => {
    it('срочное вперёд дорогого', () => {
        const plan = buildPlan(
            [
                order({ orderId: 1, statusCode: 'tender', amount: 9_000_000, lastTouchAt: '2026-08-01' }),
                order({ orderId: 2, statusCode: 'prepayed', amount: 100_000, lastTouchAt: '2026-08-20' }),
            ],
            TODAY,
            T,
        );
        const tasks = plan.get(249)!;
        expect(tasks[0].reasonCode).toBe('invoice_stale');
    });

    it('план ограничен, но потеряшки идут сверх лимита и своей нормой', () => {
        const many = Array.from({ length: 12 }, (_, i) =>
            order({ orderId: 100 + i, contactDate: '2026-08-20', amount: 100_000 + i }),
        );
        const lost = Array.from({ length: 5 }, (_, i) => order({ orderId: 200 + i, contactDate: '2023-01-01' }));
        const tasks = buildPlan([...many, ...lost], TODAY, T).get(249)!;

        expect(tasks.filter((t) => t.reasonCode !== 'lost')).toHaveLength(T.tasksPerManager);
        expect(tasks.filter((t) => t.reasonCode === 'lost')).toHaveLength(T.lostPerDay);
    });

    it('заказы разных менеджеров не смешиваются', () => {
        const plan = buildPlan(
            [order({ orderId: 1, contactDate: '2026-08-20' }), order({ orderId: 2, managerId: 98, contactDate: '2026-08-20' })],
            TODAY,
            T,
        );
        expect(plan.get(249)).toHaveLength(1);
        expect(plan.get(98)).toHaveLength(1);
    });
});

// В ru-RU разделитель разрядов — неразрывный пробел; сравниваем по смыслу.
const norm = (s: string) => s.replace(/\u00a0/g, ' ');

describe('как это читается', () => {
    const tasks = buildPlan([order({ statusCode: 'prepayed', lastTouchAt: '2026-08-28' })], TODAY, T).get(249)!;

    it('утро: тег, номер заказа, сумма, причина', () => {
        const text = formatMorning(
            { managerId: 249, managerName: 'Гордеева Ирина', telegramUsername: 'IrinaGordeeva777', tasks },
            '',
        );
        expect(text).toContain('@IrinaGordeeva777');
        expect(text).toContain('№54132');
        expect(norm(text)).toContain('500 000 ₽');
        expect(text).toContain('Счёт висит');
    });

    it('без ника тегом становится фамилия, а не пустота', () => {
        const text = formatMorning(
            { managerId: 249, managerName: 'Гордеева Ирина', telegramUsername: '', tasks },
            '',
        );
        expect(text.startsWith('Гордеева Ирина,')).toBe(true);
    });

    it('номер заказа кликабельный, когда известен адрес CRM', () => {
        const text = formatMorning(
            { managerId: 249, managerName: 'Г', telegramUsername: 'x', tasks },
            'https://zmktlt.retailcrm.ru',
        );
        expect(text).toContain('<a href="https://zmktlt.retailcrm.ru/orders/1/edit">№54132</a>');
    });

    it('вечер: сделал всё — одна строка без разбора', () => {
        const text = formatEvening(
            { managerName: 'Гордеева Ирина', telegramUsername: 'x', rows: tasks.map((t) => ({ ...t, touched: true, touchKind: 'звонок' })) },
            '',
        );
        expect(text).toContain('1 из 1');
        expect(text).toContain('✅');
        expect(text).not.toContain('Без касания');
    });

    it('вечер: не тронул — называем заказы и сумму', () => {
        const text = formatEvening(
            { managerName: 'Гордеева Ирина', telegramUsername: 'x', rows: tasks.map((t) => ({ ...t, touched: false, touchKind: null })) },
            '',
        );
        expect(text).toContain('0 из 1');
        expect(norm(text)).toContain('Не тронуто на 500 000 ₽');
    });

    it('шапка считает, сколько добирать в день до плана', () => {
        const text = formatEveningHeader({
            date: '31 августа',
            invoicesToday: 3,
            invoicesSum: 1_240_000,
            soldToday: 2,
            soldSum: 890_000,
            monthSold: 9_954_426,
            monthPlan: 13_000_000,
            workdaysLeft: 2,
        });
        expect(text).toContain('77%');
        expect(norm(text)).toContain('1 522 787 ₽ в день');
    });
});

describe('дисциплина и её последствие', () => {
    const rows = [
        { managerName: 'Матвеева Евгения', telegramUsername: 'Evgenia2222', tasksTotal: 30, tasksTouched: 29, donePct: 96.7, amountUntouched: 0 },
        { managerName: 'Гордеева Ирина', telegramUsername: 'IrinaGordeeva777', tasksTotal: 30, tasksTouched: 18, donePct: 60, amountUntouched: 4_181_372 },
    ];

    it('доля заявок падает ступенями, а не формулой', () => {
        // Менеджер должен уметь посчитать её сам, иначе это выглядит произволом.
        expect(shareOfLeads(96.7, 80)).toBe(100);
        expect(shareOfLeads(60, 80)).toBe(70);
        expect(shareOfLeads(45, 80)).toBe(50);
        expect(shareOfLeads(10, 80)).toBe(30);
    });

    it('отстающему прямо говорится, что заявок будет меньше', () => {
        const text = formatDiscipline(rows, 80, 7);
        expect(text).toContain('@IrinaGordeeva777 — 60%');
        expect(text).toContain('завтра заявок 70% от обычного');
        expect(text).toContain('Ниже 80%');
    });

    it('у выполнившего плана угрозы в строке нет', () => {
        const text = formatDiscipline(rows, 80, 7);
        expect(text).toMatch(/@Evgenia2222 — 96\.7% \(29 из 30\)\n/);
    });

    it('когда все отработали — сказано прямо, без запугивания', () => {
        const text = formatDiscipline([rows[0]], 80, 7);
        expect(text).toContain('без изменений');
        expect(text).not.toContain('меньше');
    });
});

describe('конвейер выдачи заявок', () => {
    const row = (ordinal: number, state: string) => ({ ordinal, state });

    it('первая выдача — ровно пачка, по порядку очереди', async () => {
        const { nextForOwner } = await import('@/lib/sales-rop/queue');
        const next = nextForOwner([row(3, 'parked'), row(1, 'parked'), row(2, 'parked')], 2);
        expect(next.map((r) => r.ordinal)).toEqual([1, 2]);
    });

    it('пока выданное не отработано, новое не выдаётся', async () => {
        const { nextForOwner } = await import('@/lib/sales-rop/queue');
        expect(nextForOwner([row(1, 'released'), row(2, 'released'), row(3, 'parked')], 2)).toHaveLength(0);
    });

    it('отработал одну — получает одну следующую', async () => {
        const { nextForOwner } = await import('@/lib/sales-rop/queue');
        const next = nextForOwner([row(1, 'done'), row(2, 'released'), row(3, 'parked'), row(4, 'parked')], 2);
        expect(next.map((r) => r.ordinal)).toEqual([3]);
    });

    it('очередь кончилась — выдавать нечего, и это не ошибка', async () => {
        const { nextForOwner } = await import('@/lib/sales-rop/queue');
        expect(nextForOwner([row(1, 'done'), row(2, 'done')], 2)).toHaveLength(0);
    });
});

describe('второй слой: разбор клиента моделью', () => {
    const insight = (opportunity: string, talkTrack = '') => ({ opportunity, talkTrack, evidence: '', caution: '' });
    const CATALOG = ['Шкафы металлические', 'Сушильные шкафы', 'Стеллажи'];

    it('рекомендация из нашего ассортимента проходит', async () => {
        const { mentionsCatalog } = await import('@/lib/sales-rop/analyst');
        expect(mentionsCatalog(insight('Предложить сушильные шкафы на 20 пар'), CATALOG)).toBe(true);
        // Склонения не должны ломать проверку.
        expect(mentionsCatalog(insight('Поговорить про стеллажи для склада'), CATALOG)).toBe(true);
    });

    it('выдуманный товар отбрасывается', async () => {
        const { mentionsCatalog } = await import('@/lib/sales-rop/analyst');
        // Проверено на живом прогоне: получив каталог из трёх категорий, модель
        // предложила четвёртую. Промпт запрещал — она всё равно назвала.
        expect(mentionsCatalog(insight('Предложите станки с ЧПУ и конвейерную линию'), CATALOG)).toBe(false);
    });

    it('досье для модели читается человеком и содержит динамику', async () => {
        const { renderDossier } = await import('@/lib/sales-rop/analyst');
        const text = renderDossier(
            {
                clientName: 'ТОО «КазТЭЦ»',
                sphereName: 'Производители вагон-домов',
                ordersCount: 6,
                totalAmount: 19_114_647,
                firstOrder: '2024-01-24',
                lastOrder: '2025-10-02',
                byYear: { '2024': 8_625_496, '2025': 10_489_152 },
                byCategory: { 'Сушильные шкафы': 5 },
                recentOrders: [{ number: '49104', date: '2025-10-02', amount: 1_458_200 }],
                managerComments: ['Все из 0,8 мм'],
                callTranscripts: [],
            },
            CATALOG,
        );
        expect(text).toContain('ТОО «КазТЭЦ»');
        expect(text).toContain('2024 —');
        expect(text).toContain('№49104');
        expect(text).toContain('Все из 0,8 мм');
        // Список того, что мы делаем, обязан быть в досье: без него модель
        // предлагает всё подряд.
        expect(text).toContain('Что мы производим');
    });

    it('отпечаток меняется при новой покупке и не меняется от пересборки', async () => {
        const { dossierFingerprint } = await import('@/lib/sales-rop/analyst');
        const base = {
            clientName: 'X', sphereName: 'Y', ordersCount: 6, totalAmount: 100, firstOrder: null,
            lastOrder: '2026-01-01', byYear: {}, byCategory: { A: 1 }, recentOrders: [],
            managerComments: [], callTranscripts: [],
        };
        expect(dossierFingerprint(base)).toBe(dossierFingerprint({ ...base }));
        expect(dossierFingerprint(base)).not.toBe(dossierFingerprint({ ...base, ordersCount: 7 }));
    });
});
