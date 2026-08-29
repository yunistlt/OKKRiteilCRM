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
    reasonCode: 'invoice_stale' | 'contact_overdue' | 'contact_today' | 'deal_stale' | 'big_silence' | 'lost' | 'development';
    reasonText: string;
    weight: number;
};

export type Thresholds = {
    invoiceStaleDays: number;
    /**
     * Просрочка старше этого срока — уже не «забыл перезвонить», а потеряшка.
     * Без этой границы в утренний план лезут обещания трёхлетней давности, и
     * менеджер перестаёт читать список: там кладбище, а не работа на сегодня.
     */
    overdueLimitDays: number;
    /** Сколько потеряшек добавлять в день: разгребается фоном, не вместо плана. */
    lostPerDay: number;
    dealStaleDays: number;
    bigDealAmount: number;
    bigDealSilenceDays: number;
    tasksPerManager: number;
};

/** Статусы, где заказ ещё может стать деньгами. */
export const PRESALE_STATUSES = [
    'prepayed',
    'availability',
    'raschet',
    'na-soglasovanii',
    'v-proscete',
    'otmenili-zakupku-smeta',
    'ozidanie-tz',
    'zapros-kontaktov',
    'tender',
    'ozhidanie-vykhoda-tendera',
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
        return contactIn <= t.overdueLimitDays
            ? make('contact_overdue', `обещали связаться ${days(contactIn)} назад — просрочено`)
            : make('lost', `потеряшка: последнее обещание ${days(contactIn)} назад`);
    }

    if (contactIn === 0) {
        return make('contact_today', 'сегодня по плану звонок клиенту');
    }

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
export function buildPlan(orders: PresaleOrder[], today: string, t: Thresholds): Map<number | null, Task[]> {
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
            lost: 6,
        };
        list.sort((a: Task, b: Task) => rank[a.reasonCode] - rank[b.reasonCode] || b.weight - a.weight);

        // Потеряшки идут сверх плана и дозированно: их сотни, и вывалить их
        // целиком — то же самое, что не дать ничего.
        // То, что менеджер сам назначил на сегодня, не режется лимитом никогда.
        // Это его собственный план из CRM, и если наш отбор его вытеснит, человек
        // решит, что работать надо только по присланному, — и свои договорённости
        // с клиентами пропустит.
        const own = list.filter((x: Task) => x.reasonCode === 'contact_today');

        // Развитие идёт сверх дневного лимита: это работа вдолгую, и если её
        // резать первой, она не делается никогда — а цель в 300 постоянных
        // клиентов достигается только ею.
        const live = list
            .filter(
                (x: Task) =>
                    x.reasonCode !== 'lost' && x.reasonCode !== 'development' && x.reasonCode !== 'contact_today',
            )
            .slice(0, t.tasksPerManager);
        const dev = list.filter((x: Task) => x.reasonCode === 'development');
        const lost = list.filter((x: Task) => x.reasonCode === 'lost').slice(0, t.lostPerDay);
        // Свои плановые звонки идут первыми: это обещания, данные клиентам.
        byManager.set(managerId, [...own, ...live, ...dev, ...lost]);
    }

    return byManager;
}
