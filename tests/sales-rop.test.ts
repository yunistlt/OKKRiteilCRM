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
    freshOverdueDays: 30,
    coldPerDay: 2,
    dailyTarget: 12,
    minAlways: 3,
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

    it('обещание старше границы — остывшее, а не задача на сегодня', () => {
        const t = taskFor(order({ contactDate: '2023-06-01' }), TODAY, T);
        expect(t?.reasonCode).toBe('cold');
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

    it('план ограничен, но остывшие идут сверх лимита и своей нормой', () => {
        const many = Array.from({ length: 12 }, (_, i) =>
            order({ orderId: 100 + i, contactDate: '2026-08-25', amount: 100_000 + i }),
        );
        const cold = Array.from({ length: 5 }, (_, i) => order({ orderId: 200 + i, contactDate: '2023-01-01' }));
        const tasks = buildPlan([...many, ...cold], TODAY, T).get(249)!;

        expect(tasks.filter((t) => t.reasonCode !== 'cold')).toHaveLength(T.tasksPerManager);
        // Остывшими день добирается до нормы: своих ноль, живых семь — значит
        // добавится пять, а не две.
        expect(tasks.filter((t) => t.reasonCode === 'cold')).toHaveLength(T.dailyTarget - T.tasksPerManager);
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
                sphereCode: 'elektroseti',
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

describe('человеческая обёртка утреннего плана', () => {
    const tasks = buildPlan([order({ statusCode: 'prepayed', lastTouchAt: '2026-08-28' })], TODAY, T).get(249)!;
    const plan = { managerId: 249, managerName: 'Гордеева Ирина', telegramUsername: 'IrinaGordeeva777', tasks };

    it('приветствие внутри личного сообщения, по имени и с датой', async () => {
        const { formatMorning } = await import('@/lib/sales-rop/format');
        const text = formatMorning(plan, '', {
            greeting: '☀️ Доброе утро, {{имя}}! {{дата}}',
            farewell: 'Хорошего дня!',
            date: new Date(TODAY),
        });
        // Обращение по имени, а не по фамилии: это сообщение человеку.
        expect(text.startsWith('☀️ Доброе утро, Ирина!')).toBe(true);
        expect(text).toContain('31 августа');
        expect(text).toContain('@IrinaGordeeva777');
        expect(text.trimEnd().endsWith('Хорошего дня!')).toBe(true);
    });

    it('имя берётся из «Фамилия Имя»', async () => {
        const { firstNameOf } = await import('@/lib/sales-rop/format');
        expect(firstNameOf('Гордеева Ирина')).toBe('Ирина');
        expect(firstNameOf('Ярослав')).toBe('Ярослав');
        expect(firstNameOf('')).toBe('');
    });

    it('без шаблонов сообщение остаётся прежним', async () => {
        const { formatMorning } = await import('@/lib/sales-rop/format');
        const text = formatMorning(plan, '');
        expect(text.startsWith('@IrinaGordeeva777, на сегодня 1 шт.')).toBe(true);
    });
});

describe('собственный план менеджера', () => {
    it('заказы с датой контакта на сегодня не режутся лимитом и идут первыми', () => {
        // Это обещания, данные клиентам: если наш отбор их вытеснит, человек
        // решит, что работать надо только по присланному.
        const own = Array.from({ length: 9 }, (_, i) =>
            order({ orderId: 300 + i, contactDate: TODAY, amount: 50_000 + i }),
        );
        const ours = Array.from({ length: 12 }, (_, i) =>
            order({ orderId: 400 + i, contactDate: '2026-08-20', amount: 900_000 + i }),
        );
        const tasks = buildPlan([...own, ...ours], TODAY, T).get(249)!;

        expect(tasks.filter((t) => t.reasonCode === 'contact_today')).toHaveLength(9);
        expect(tasks[0].reasonCode).toBe('contact_today');
        // Своих девять при норме двенадцать — наших добавляется остаток до нормы,
        // а не полный лимит: иначе не будут сделаны ни те, ни другие.
        expect(tasks.filter((t) => t.reasonCode === 'contact_overdue')).toHaveLength(3);
    });

    it('в шапке разделено: сколько своих и сколько добавили мы', async () => {
        const { formatMorning } = await import('@/lib/sales-rop/format');
        const tasks = buildPlan(
            [order({ orderId: 1, contactDate: TODAY }), order({ orderId: 2, contactDate: '2026-08-20' })],
            TODAY,
            T,
        ).get(249)!;
        const text = formatMorning({ managerId: 249, managerName: 'Г И', telegramUsername: 'x', tasks }, '');
        expect(text).toContain('1 твоих по плану и 1 от меня');
        expect(text).toContain('📅 Твой план на сегодня (из CRM)');
    });
});

describe('рекомендации РОПа в карточке заказа', () => {
    it('строка начинается датой и подписью', async () => {
        const { formatRopNote } = await import('@/lib/sales-rop/crm-note');
        expect(formatRopNote('позвонить, счёт висит 3 дня', new Date('2026-08-31'))).toBe(
            '31.08.2026 РОП: позвонить, счёт висит 3 дня',
        );
    });

    it('комментарий менеджера не затирается — это главное', async () => {
        const { mergeComment, formatRopNote } = await import('@/lib/sales-rop/crm-note');
        // Тут живут договорённости, стоившие менеджеру полугода переписки.
        const human = 'Все из 0,8 мм\nНаша резка 16105р\n02.10 примерно в пн оплата';
        const merged = mergeComment(human, formatRopNote('уточнить оплату', new Date('2026-08-31')));
        expect(merged).toContain('Все из 0,8 мм');
        expect(merged).toContain('Наша резка 16105р');
        expect(merged).toContain('31.08.2026 РОП: уточнить оплату');
    });

    it('свежая заметка сверху, старые ниже', async () => {
        const { mergeComment, formatRopNote } = await import('@/lib/sales-rop/crm-note');
        const existing = '30.08.2026 РОП: старое\nкомментарий менеджера';
        const merged = mergeComment(existing, formatRopNote('новое', new Date('2026-08-31')));
        const lines = merged.split('\n');
        expect(lines[0]).toContain('31.08.2026');
        expect(lines[1]).toContain('30.08.2026');
    });

    it('заметок РОПа не больше пяти, комментарии менеджера не режутся', async () => {
        const { mergeComment, formatRopNote } = await import('@/lib/sales-rop/crm-note');
        let comment = 'важная договорённость с клиентом';
        for (let day = 20; day <= 30; day += 1) {
            comment = mergeComment(comment, formatRopNote(`совет ${day}`, new Date(`2026-08-${day}`)));
        }
        const ropLines = comment.split('\n').filter((l) => l.includes('РОП:'));
        expect(ropLines).toHaveLength(5);
        expect(comment).toContain('важная договорённость с клиентом');
    });

    it('дважды за день не пишем', async () => {
        const { alreadyNotedToday } = await import('@/lib/sales-rop/crm-note');
        const comment = '31.08.2026 РОП: позвонить\nтекст менеджера';
        expect(alreadyNotedToday(comment, new Date('2026-08-31'))).toBe(true);
        expect(alreadyNotedToday(comment, new Date('2026-09-01'))).toBe(false);
    });
});

describe('ритм заметок РОПа', () => {
    it('первую заметку пишем всегда', async () => {
        const { noteNeeded } = await import('@/lib/sales-rop/crm-note');
        expect(noteNeeded(null, null)).toBe(true);
        expect(noteNeeded(null, '2026-08-25T10:00:00Z')).toBe(true);
    });

    it('предыдущий совет висит нетронутым — молчим', async () => {
        const { noteNeeded } = await import('@/lib/sales-rop/crm-note');
        // По заказу с прошлой записи ничего не произошло: ситуация та же, совет
        // тот же, а вторая одинаковая строка обесценивает и первую.
        expect(noteNeeded('2026-08-28T06:00:00Z', null)).toBe(false);
        expect(noteNeeded('2026-08-28T06:00:00Z', '2026-08-27T15:00:00Z')).toBe(false);
    });

    it('менеджер поработал после совета — пишем новый', async () => {
        const { noteNeeded } = await import('@/lib/sales-rop/crm-note');
        expect(noteNeeded('2026-08-28T06:00:00Z', '2026-08-28T11:30:00Z')).toBe(true);
    });
});

describe('нагрузка на день', () => {
    it('день недобран — добираем остывшими до нормы', () => {
        // У одного менеджера четырнадцать своих звонков, у другого четыре: без
        // добора второй получит полупустой день, хотя в базе сотни остывших.
        const own = [order({ orderId: 1, contactDate: TODAY })];
        const cold = Array.from({ length: 20 }, (_, i) =>
            order({ orderId: 400 + i, contactDate: '2025-01-01', amount: 100_000 * (i + 1) }),
        );
        const tasks = buildPlan([...own, ...cold], TODAY, T).get(249)!;
        expect(tasks.length).toBeGreaterThanOrEqual(T.dailyTarget - 1);
        // Дорогие первыми.
        const coldTasks = tasks.filter((t) => t.reasonCode === 'cold');
        expect(coldTasks[0].amount).toBeGreaterThan(coldTasks[coldTasks.length - 1].amount);
    });

    it('своих мало — добавляем полный лимит наших', () => {
        const own = [order({ orderId: 1, contactDate: TODAY })];
        const ours = Array.from({ length: 12 }, (_, i) =>
            order({ orderId: 100 + i, contactDate: '2026-08-25', amount: 100_000 + i }),
        );
        const tasks = buildPlan([...own, ...ours], TODAY, T).get(249)!;
        expect(tasks.filter((t) => t.reasonCode === 'contact_overdue')).toHaveLength(T.tasksPerManager);
    });

    it('своих много — наших добавляем только самое горячее', () => {
        const own = Array.from({ length: 14 }, (_, i) => order({ orderId: 200 + i, contactDate: TODAY }));
        const ours = Array.from({ length: 10 }, (_, i) =>
            order({ orderId: 300 + i, contactDate: '2026-08-25', amount: 500_000 }),
        );
        const tasks = buildPlan([...own, ...ours], TODAY, T).get(249)!;
        expect(tasks.filter((t) => t.reasonCode === 'contact_today')).toHaveLength(14);
        expect(tasks.filter((t) => t.reasonCode === 'contact_overdue')).toHaveLength(T.minAlways);
    });
});

describe('срез дня по звонкам', () => {
    it('показывает факт и сравнение со своим средним', async () => {
        const { formatCallDay } = await import('@/lib/sales-rop/format');
        const text = formatCallDay({
            calls: 40, talks: 30, outgoing: 27, incoming: 13, minutes: 53,
            firstCall: '2026-08-28T06:12:00Z', lastCall: '2026-08-28T14:40:00Z',
            avgCalls: 44.1, avgTalks: 35.3, avgMinutes: 59,
        });
        expect(text).toContain('40 (27 исходящих, 13 входящих)');
        // Время заводское, а не UTC: 06:12 UTC — это 10:12 в Тольятти.
        expect(text).toContain('Первый звонок 10:12');
        expect(text).toContain('Разговоров дольше 20 секунд: 30');
        // Сравниваем с его же средним, а не с коллегами: у одного крупные сделки
        // и длинные разговоры, у другого поток мелких.
        expect(text).toContain('меньше обычного');
    });

    it('без истории сравнения нет, но факт остаётся', async () => {
        const { formatCallDay } = await import('@/lib/sales-rop/format');
        const text = formatCallDay({
            calls: 5, talks: 3, outgoing: 5, incoming: 0, minutes: 7,
            firstCall: null, lastCall: null, avgCalls: null, avgTalks: null, avgMinutes: null,
        });
        expect(text).toContain('Звонки за день: 5');
        expect(text).not.toContain('среднее');
    });
});

describe('пустые звонки', () => {
    const call = (over: any) => ({ at: '2026-08-28T09:00:00Z', direction: 'исходящий', phone: '790', orderNumber: null, ...over });

    it('короткий звонок — не разговор', async () => {
        const { isEmptyCall } = await import('@/lib/sales-rop/call-review');
        expect(isEmptyCall(call({ durationSec: 4, transcript: 'Менеджер: Компания «ЗМК», добрый день.' }))).toBe(true);
    });

    it('заставка распознавания тишины — не разговор', async () => {
        const { isEmptyCall } = await import('@/lib/sales-rop/call-review');
        // Whisper на тишине автоответчика выдаёт «Продолжение следует...».
        expect(isEmptyCall(call({ durationSec: 40, transcript: 'Менеджер: Продолжение следует...' }))).toBe(true);
        expect(isEmptyCall(call({ durationSec: 30, transcript: 'Субтитры сделал DimaTorzok' }))).toBe(true);
    });

    it('настоящий разговор считается', async () => {
        const { isEmptyCall } = await import('@/lib/sales-rop/call-review');
        const text = 'Менеджер: Дмитрий, здравствуйте, это Ирина из ЗМК. Клиент: Да, добрый день, я по счёту хотел уточнить сроки поставки и оплату.';
        expect(isEmptyCall(call({ durationSec: 95, transcript: text }))).toBe(false);
    });
});
