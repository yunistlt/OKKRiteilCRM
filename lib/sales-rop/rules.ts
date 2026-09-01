// Отбор задач на день для бота-РОПа.
//
// Правила ровно те, что видно в данных, а не придуманные:
//
//   • «Счёт на оплате» конвертится в производство на 85 % за один день. Это
//     самое дорогое место воронки, и висящий счёт — потерянные деньги сегодня.
//   • У заказов в «Отложено» дата следующего контакта заполнена у всех, и у 124
//     она уже прошла. Это не холодная база, а невыполненные обещания.
//   • «Согласование параметров» даёт 29 %, договор — 78 %, и оба идут 8 дней.
//     Молчание на этих стадиях — прямая потеря.
//
// Пороги приходят из sales_rop_settings: в коде их нет, завтра они будут другими.

export type PresaleOrder = {
    orderId: number;
    number: string;
    client: string;
    statusCode: string;
    statusName: string;
    amount: number;
    managerId: number | null;
    /** Дата следующего контакта из карточки заказа, если проставлена. */
    contactDate: string | null;
    /** Когда по заказу последний раз что-то происходило. */
    lastTouchAt: string | null;
};

export type Task = {
    orderId: number;
    number: string;
    client: string;
    statusCode: string;
    statusName: string;
    amount: number;
    managerId: number | null;
    reasonCode: 'invoice_stale' | 'contact_overdue' | 'contact_today' | 'deal_stale' | 'big_silence' | 'cold' | 'development' | 'reactivation';
    reasonText: string;
    weight: number;
};

export type Thresholds = {
    invoiceStaleDays: number;
    /**
     * Граница свежей просрочки. До неё обещание ещё живо и его дожимают;
     * дальше — работа по остывшей базе, и её дают дозированно.
     */
    freshOverdueDays: number;
    /** Сколько остывших просрочек добавлять сверх плана. */
    coldPerDay: number;


    dealStaleDays: number;
    bigDealAmount: number;
    bigDealSilenceDays: number;
    tasksPerManager: number;
    /**
     * Сколько задач в день считаем посильной нормой вместе с собственными.
     *
     * У менеджера может быть четырнадцать своих звонков на сегодня — тогда
     * добавлять сверху ещё семь наших значит гарантировать, что не сделают ни
     * те, ни другие. Наши задачи заполняют остаток до нормы, но самое горячее
     * (висящий счёт) идёт всегда: там деньги, и их нельзя откладывать.
     */
    dailyTarget: number;
    minAlways: number;
};

/**
 * Запасной список рабочих статусов.
 *
 * Настоящий источник — status_settings.is_working в базе: разметку ведёт
 * человек, и она меняется. Список здесь нужен на случай, если таблица недоступна:
 * пустой план хуже неточного.
 */
export const PRESALE_STATUSES = [
    'prepayed',
    'availability',
    'raschet',
    'na-soglasovanii',
    'v-proscete',
    'otmenili-zakupku-smeta',
    'ozidanie-tz',
    'zapros-kontaktov',
    'otlozeno',
    'novyi-1',
] as const;

/**
 * Вероятность дойти до производства — измеренная по 2026 году, а не назначенная.
 * Нужна только для сортировки: она решает, что менеджер увидит первым.
 */
const WIN_RATE: Record<string, number> = {
    prepayed: 0.85,
    availability: 0.77,
    raschet: 0.78,
    'na-soglasovanii': 0.29,
    'v-proscete': 0.17,
    'zapros-kontaktov': 0.15,
    'ozidanie-tz': 0.14,
    otlozeno: 0.09,
    'novyi-1': 0.08,
    'ozhidanie-vykhoda-tendera': 0.07,
    tender: 0.04,
    'otmenili-zakupku-smeta': 0.05,
};

const DAY = 24 * 60 * 60 * 1000;

export function daysBetween(from: string | Date, to: string | Date): number {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    return Math.floor((b - a) / DAY);
}

function plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

export const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
export const purchases = (n: number) => `${n} ${plural(n, 'покупка', 'покупки', 'покупок')}`;

/**
 * Одна задача на заказ, даже если он подходит под несколько правил: список из
 * семи строк, где один и тот же заказ назван трижды, менеджер читать перестанет.
 * Правила идут по убыванию срочности.
 */
export function taskFor(order: PresaleOrder, today: string, t: Thresholds): Task | null {
    const silence = order.lastTouchAt ? daysBetween(order.lastTouchAt, today) : null;
    const contactIn = order.contactDate ? daysBetween(order.contactDate, today) : null;

    const make = (reasonCode: Task['reasonCode'], reasonText: string): Task => ({
        orderId: order.orderId,
        number: order.number,
        client: order.client,
        statusCode: order.statusCode,
        statusName: order.statusName,
        amount: order.amount,
        managerId: order.managerId,
        reasonCode,
        reasonText,
        weight: order.amount * (WIN_RATE[order.statusCode] ?? 0.05),
    });

    if (order.statusCode === 'prepayed' && (silence ?? 0) >= t.invoiceStaleDays) {
        return make('invoice_stale', `счёт выставлен, оплаты нет ${days(silence ?? 0)} — узнать, когда платят`);
    }

    if (contactIn !== null && contactIn > 0) {
        // Свежая просрочка — это нарушенное обещание, по нему звонят сегодня.
        // Остывшая — работа по базе: её тоже надо делать, но не вместо горячего.
        if (contactIn <= t.freshOverdueDays) {
            return make('contact_overdue', `обещали связаться ${days(contactIn)} назад — просрочено`);
        }
        return make('cold', `остыл: обещание ${days(contactIn)} назад, поднять или закрыть`);
    }

    if (contactIn === 0) {
        return make('contact_today', 'сегодня по плану звонок клиенту');
    }

    // Дата контакта в будущем — это решение человека: клиент попросил вернуться
    // в ноябре, менеджер так и записал. Такой заказ мы не трогаем ничем: ни
    // «сделка стоит», ни «крупный молчит» здесь не применимы — он не стоит, он
    // ждёт назначенного срока.
    //
    // Инцидент 01.09.2026: заказ №53971 с датой 20.11 попал в план по правилу
    // «согласование без движения», и простановка даты затёрла ноябрь сегодняшним
    // числом. Стёрлась договорённость с клиентом, а менеджер получил заказ
    // обратно на два месяца раньше срока.
    if (contactIn !== null && contactIn < 0) return null;

    if (
        ['na-soglasovanii', 'raschet', 'availability', 'v-proscete', 'ozidanie-tz'].includes(order.statusCode) &&
        (silence ?? 0) >= t.dealStaleDays
    ) {
        return make('deal_stale', `${order.statusName.toLowerCase()} без движения ${days(silence ?? 0)}`);
    }

    if (order.amount >= t.bigDealAmount && (silence ?? 0) >= t.bigDealSilenceDays) {
        return make('big_silence', `крупный заказ молчит ${days(silence ?? 0)}`);
    }

    return null;
}

/** План на день: по задаче на заказ, не больше N на менеджера, дорогое — первым. */
export function buildPlan(
    orders: PresaleOrder[],
    today: string,
    t: Thresholds,
    /** Сколько новых заявок в день приходит менеджеру — их разбирают до плана. */
    intakeByManager: Map<number | null, number> = new Map(),
): Map<number | null, Task[]> {
    const byManager = new Map<number | null, Task[]>();

    for (const order of orders) {
        const task = taskFor(order, today, t);
        if (!task) continue;
        const list = byManager.get(task.managerId) ?? [];
        list.push(task);
        byManager.set(task.managerId, list);
    }

    for (const [managerId, list] of Array.from(byManager.entries())) {
        // Просрочка вперёд денег: обещание, которое уже нарушено, дороже
        // крупной суммы, до которой ещё никто ничего не обещал.
        const rank: Record<Task['reasonCode'], number> = {
            invoice_stale: 0,
            contact_overdue: 1,
            contact_today: 2,
            deal_stale: 3,
            big_silence: 4,
            development: 5,
            cold: 6,
            reactivation: 7,
        };
        list.sort((a: Task, b: Task) => rank[a.reasonCode] - rank[b.reasonCode] || b.weight - a.weight);

        // То, что менеджер сам назначил на сегодня, не режется лимитом никогда.
        // Это его собственный план из CRM, и если наш отбор его вытеснит, человек
        // решит, что работать надо только по присланному, — и свои договорённости
        // с клиентами пропустит.
        const own = list.filter((x: Task) => x.reasonCode === 'contact_today');

        // Сколько наших задач добавить: остаток от нормы дня после собственных
        // звонков и разбора новых заявок. Заявки приходят каждый день и ждать не
        // могут, поэтому место под них резервируется до всего остального.
        const intake = Math.round(intakeByManager.get(managerId) ?? 0);
        const budget = t.dailyTarget - own.length - intake;
        const room = Math.max(t.minAlways, Math.min(t.tasksPerManager, budget));

        const live = list
            .filter(
                (x: Task) =>
                    x.reasonCode !== 'cold' &&
                    x.reasonCode !== 'development' &&
                    x.reasonCode !== 'reactivation' &&
                    x.reasonCode !== 'contact_today',
            )
            .slice(0, room);
        // Развитие идёт сверх дневного лимита: это работа вдолгую, и если её
        // резать первой, она не делается никогда — а цель в 300 постоянных
        // клиентов достигается только ею.
        const dev = list.filter(
            (x: Task) => x.reasonCode === 'development' || x.reasonCode === 'reactivation',
        );

        // Остывшими добираем день до нормы. У одного менеджера четырнадцать
        // своих звонков и добавлять нечего, у другого четыре — и его день
        // наполовину пуст, хотя в базе лежат сотни остывших заказов. Недогруз —
        // такая же потеря, как перегруз.
        //
        // Дорогое вперёд: если разбирать остывшую базу, то начиная с крупных.
        const shortfall = Math.max(0, t.dailyTarget - own.length - intake - live.length);

        // День уже полон собственными звонками и разбором заявок — остывших не
        // добавляем вовсе. Норма существует, чтобы её соблюдать в обе стороны:
        // список, который заведомо не сделать, не выполняют весь, а не частично.
        const cold =
            shortfall === 0
                ? []
                : list
                      .filter((x: Task) => x.reasonCode === 'cold')
                      .sort((a: Task, b: Task) => b.amount - a.amount)
                      .slice(0, Math.max(t.coldPerDay, shortfall));
        // Свои плановые звонки идут первыми: это обещания, данные клиентам.
        byManager.set(managerId, [...own, ...live, ...dev, ...cold]);
    }

    return byManager;
}
