import type { Task } from '@/lib/sales-rop/rules';
import { days, plural } from '@/lib/sales-rop/rules';

// Тексты бота-РОПа. Живут отдельно от правил, потому что правится тут чаще
// всего, и потому что форму сообщения согласовывает человек, а не тест.

export type ManagerPlan = {
    managerId: number | null;
    managerName: string;
    telegramUsername: string;
    tasks: Task[];
};

export type CrmLinkBase = string;

const money = (v: number) => Math.round(v).toLocaleString('ru-RU');

/** Ссылка на заказ в RetailCRM: номер должен открываться в один клик. */
export function orderLink(base: CrmLinkBase, orderId: number, number: string): string {
    if (!base) return `№${number}`;
    return `<a href="${base}/orders/${orderId}/edit">№${number}</a>`;
}

function tag(username: string, name: string): string {
    return username ? `@${username.replace(/^@/, '')}` : name;
}

/** Заголовки причин — чтобы задачи в сообщении шли смысловыми блоками. */
const REASON_TITLE: Record<Task['reasonCode'], string> = {
    invoice_stale: '🔴 Счёт висит',
    contact_overdue: '🟠 Просрочено обещание',
    contact_today: '📅 Твой план на сегодня (из CRM)',
    deal_stale: '🔵 Сделка стоит',
    big_silence: '⚪️ Крупный молчит',
    development: '🟢 Развитие клиента — что ещё предложить',
    cold: '⚫️ Остывшие — поднять или закрыть',
    reactivation: '📞 Обзвон базы — давно не покупали',
    // Отношения с клиентом, а не сделка: сюда попадают и те, кто ни разу не
    // покупал. Заголовок про клиента, не про заказ.
    client_touch: '🤝 Напомнить о себе — давно не общались',
};

/**
 * Приветствие и прощание — отдельными сообщениями вокруг планов.
 *
 * Тексты живут в настройках, а не в коде: состав отдела меняется, «девочки»
 * однажды перестанут быть верным обращением, и менять это должен человек, а не
 * деплой. Дата пишется словами — сообщение читают люди, а не парсер.
 */
export function formatGreeting(
    template: string,
    date: Date,
    params: { managers: number; tasks: number; totalAmount: number },
): string {
    const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
    return template
        .replace('{{дата}}', day)
        .replace('{{менеджеров}}', String(params.managers))
        .replace('{{задач}}', String(params.tasks))
        .replace('{{сумма}}', money(params.totalAmount));
}

/** Имя из «Фамилия Имя»: обращаться к человеку по фамилии — это не по-человечески. */
export function firstNameOf(fullName: string): string {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts[1] : parts[0] || '';
}

export function formatMorning(
    plan: ManagerPlan,
    base: CrmLinkBase,
    wrap?: { greeting?: string; farewell?: string; date?: Date },
): string {
    const live = plan.tasks.filter((t: Task) => t.reasonCode !== 'cold');
    const own = plan.tasks.filter((t: Task) => t.reasonCode === 'contact_today').length;
    const added = live.length - own;
    // Блок, где живых задач нет, а потеряшки есть, — это не «план на 0 шт.»,
    // а разбор архива. Называем вещи своими именами, иначе сообщение выглядит
    // как ошибка бота и его перестают читать.
    // Приветствие вкладывается в личное сообщение, а не идёт общим: три
    // сообщения в чате читаются, пять — уже лента, которую пролистывают.
    const who = tag(plan.telegramUsername, plan.managerName);
    const hello = wrap?.greeting
        ? wrap.greeting
              .replace('{{имя}}', firstNameOf(plan.managerName))
              .replace('{{тег}}', who)
              .replace(
                  '{{дата}}',
                  (wrap.date ?? new Date()).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      weekday: 'long',
                  }),
              )
        : '';

    // В шапке разделено: сколько человек запланировал сам и сколько добавили мы.
    // Иначе присланный список читается как замена его собственному плану.
    const head =
        live.length > 0
            ? `${who}, на сегодня ${live.length} шт.` +
              (own > 0 && added > 0
                  ? ` — ${own} твоих по плану и ${added} от меня`
                  : own > 0
                    ? ' — все твои по плану'
                    : '')
            : `${who}, на сегодня срочного нет — разобрать архив:`;
    const lines: string[] = hello ? [hello, '', head] : [head];

    let lastReason: string | null = null;
    for (const t of plan.tasks) {
        if (t.reasonCode !== lastReason) {
            lines.push('', REASON_TITLE[t.reasonCode]);
            lastReason = t.reasonCode;
        }
        // У напоминания о клиенте суммы может не быть вовсе: человек обращался,
        // но до просчёта не дошло. «0 ₽» в такой строке читается как сделка на
        // ноль рублей, поэтому сумму просто не пишем.
        const head = t.amount > 0 ? `${money(t.amount)} ₽ — ` : '';
        lines.push(
            `${orderLink(base, t.orderId, t.number)} — ${head}${t.client || 'клиент не указан'}`,
            `   ${t.reasonText}`,
        );
    }

    if (live.length > 0) {
        const sum = live.reduce((s: number, t: Task) => s + t.amount, 0);
        lines.push('', `Всего в работе на сегодня: ${money(sum)} ₽`);
    }
    if (wrap?.farewell) lines.push('', wrap.farewell);
    return lines.join('\n');
}

export type EveningRow = Task & { touched: boolean; touchKind: string | null };

export function formatEvening(
    plan: { managerName: string; telegramUsername: string; rows: EveningRow[] },
    base: CrmLinkBase,
): string {
    const done = plan.rows.filter((r) => r.touched);
    const missed = plan.rows.filter((r) => !r.touched);

    const head =
        `${tag(plan.telegramUsername, plan.managerName)} — ${done.length} из ${plan.rows.length}` +
        (missed.length === 0 ? ' ✅' : '');

    if (missed.length === 0) return head;

    const lines = [head, ''];
    lines.push('Без касания:');
    for (const r of missed) {
        lines.push(`${orderLink(base, r.orderId, r.number)} — ${money(r.amount)} ₽ — ${r.client || 'клиент не указан'}`);
    }
    const lost = missed.reduce((s, r) => s + r.amount, 0);
    lines.push('', `Не тронуто на ${money(lost)} ₽`);
    return lines.join('\n');
}

export type DisciplineRow = {
    managerName: string;
    telegramUsername: string;
    tasksTotal: number;
    tasksTouched: number;
    donePct: number;
    amountUntouched: number;
};

/**
 * Дисциплина: доля отработанных задач по каждому за последние дни.
 *
 * Печатается каждый вечер и с прямым следствием — сколько заявок человек
 * получит завтра. Показатель без последствия превращается в фон: его читают
 * неделю, потом перестают. Доля заявок считается ступенями, а не формулой:
 * менеджер должен уметь посчитать её сам, иначе это выглядит произволом.
 */
export function shareOfLeads(donePct: number, warnPct: number): number {
    if (donePct >= warnPct) return 100;
    if (donePct >= warnPct - 20) return 70;
    if (donePct >= warnPct - 40) return 50;
    return 30;
}

export function formatDiscipline(rows: DisciplineRow[], warnPct = 80, periodDays = 7): string {
    if (rows.length === 0) return '';
    const sorted = [...rows].sort((a, b) => b.donePct - a.donePct);
    const lines = [`📈 Дисциплина за ${days(periodDays)} — доля отработанных задач:`];

    for (const r of sorted) {
        const name = r.telegramUsername ? `@${r.telegramUsername.replace(/^@/, '')}` : r.managerName;
        const share = shareOfLeads(r.donePct, warnPct);
        lines.push(
            `${name} — ${r.donePct}% (${r.tasksTouched} из ${r.tasksTotal})` +
                (r.amountUntouched > 0 ? `, не тронуто на ${money(r.amountUntouched)} ₽` : '') +
                (share < 100 ? ` → завтра заявок ${share}% от обычного` : ''),
        );
    }

    const weak = sorted.filter((r) => r.donePct < warnPct);
    if (weak.length > 0) {
        lines.push('', `Ниже ${warnPct}% — новых заявок завтра меньше. Догнать можно сегодня же: отработать то, что осталось.`);
    } else {
        lines.push('', 'Все отработали план — распределение заявок без изменений.');
    }
    return lines.join('\n');
}

export type CallDay = {
    calls: number;
    talks: number;
    /** Разбивка незачтённых: автоответчик, тишина, короткие, без записи. */
    machine?: number;
    noAnswer?: number;
    noRecord?: number;
    outgoing: number;
    incoming: number;
    minutes: number;
    firstCall: string | null;
    lastCall: string | null;
    avgCalls: number | null;
    avgTalks: number | null;
    avgMinutes: number | null;
    /** Норма разговоров в день, минут. */
    targetMinutes: number;
    /**
     * Норма состоявшихся разговоров в день — одна на всех.
     *
     * Оклад у менеджеров одинаковый, значит и требование одинаковое: у кого не
     * получается, это его вопрос, а не повод считать ему отдельную планку.
     *
     * Тридцать пять — цифра, проверенная практикой отдела: раньше ставили
     * пятьдесят и снижали до сорока, а лучшие дни за два месяца — 42-46, причём
     * у разных людей.
     */
    targetTalks: number;
};

/**
 * Срез дня по звонкам.
 *
 * Показываем факт и сравнение со своим же средним — не с чужим. Сравнение
 * менеджеров между собой здесь бесполезно: у одного крупные сделки и длинные
 * разговоры, у другого поток мелких. А вот «сегодня вдвое меньше, чем обычно у
 * тебя» — это разговор по делу.
 *
 * Разговором считается звонок длиннее двадцати секунд: короче — это гудки и
 * «перезвоните позже», и складывать их с разговорами значит завышать работу.
 */
export function formatCallDay(d: CallDay, utcOffsetHours = 4): string {
    // Время заводское: в UTC первый звонок выглядит как 06:26, и менеджер решит,
    // что бот считает не его день.
    const hhmm = (v: string | null) =>
        v ? new Date(new Date(v).getTime() + utcOffsetHours * 3600_000).toISOString().slice(11, 16) : '—';
    const lines = [
        `📞 Звонки за день: ${d.calls} (${d.outgoing} исходящих, ${d.incoming} входящих)`,
        `Подтверждённых разговоров: ${d.talks}, в трубке ${d.minutes} мин`,
    ];

    // Разбивка незачтённого: без неё цифра выглядит придиркой, с ней — фактом.
    const rest: string[] = [];
    if (d.machine) rest.push(`${d.machine} автоответчик`);
    if (d.noAnswer) rest.push(`${d.noAnswer} без ответа`);
    if (d.noRecord) rest.push(`${d.noRecord} без записи`);
    if (rest.length > 0) lines.push(`Не зачтено: ${rest.join(', ')}`);

    if (d.firstCall && d.lastCall) lines.push(`Первый звонок ${hhmm(d.firstCall)}, последний ${hhmm(d.lastCall)}`);

    if (d.targetTalks > 0) {
        const left = Math.max(0, d.targetTalks - d.talks);
        const pct = Math.round((d.talks * 100) / d.targetTalks);
        lines.push(
            '',
            left > 0
                ? `Норма ${d.targetTalks} разговоров в день: сделано ${d.talks} (${pct}%), не хватает ${left}.`
                : `Норма ${d.targetTalks} разговоров выполнена: ${d.talks} (${pct}%). 👍`,
        );
    }

    // Норма по минутам выключена намеренно (talk_minutes_target = 0).
    // Показатель поощряет длинные разговоры, а не результативные: под план по
    // минутам начинают говорить о погоде. Минуты остаются в сводке как справка,
    // требованием они не служат. Механика оставлена на случай разбора.
    if (d.targetMinutes > 0) {
        const pct = Math.round((d.minutes * 100) / d.targetMinutes);
        const left = Math.max(0, d.targetMinutes - d.minutes);
        lines.push(
            '',
            left > 0
                ? `Норма ${d.targetMinutes} мин в разговорах: сделано ${pct}%, не хватает ${left} мин.`
                : `Норма ${d.targetMinutes} мин в разговорах выполнена (${pct}%).`,
        );
    }

    if (d.avgCalls !== null && d.avgTalks !== null) {
        const diff = d.talks - d.avgTalks;
        const mark = diff >= 1 ? 'больше обычного' : diff <= -1 ? 'меньше обычного' : 'как обычно';
        lines.push('', `Твоё среднее за две недели: ${d.avgCalls} звонков, ${d.avgTalks} разговоров, ${d.avgMinutes} мин — сегодня ${mark}.`);
    }

    return lines.join('\n');
}

export type OwnerRow = {
    managerName: string;
    tasksTotal: number;
    tasksDone: number;
    amountUntouched: number;
    calls: number;
    talks: number;
    machine: number;
    minutes: number;
};

/**
 * Вечерний отчёт владельцу.
 *
 * Отличается от менеджерского не тоном, а составом: владельцу нужны отдел
 * целиком и то, что требует его решения, а не подсказки по конкретным заказам.
 * Поимённо — потому что «отдел сделал 60%» не говорит, с кем разговаривать.
 */
export type ContactDates = {
    movedToday: number;
    movedByDay: number;
    overdue: number;
    peakDate: string | null;
    peakCount: number;
};

/**
 * Что человек за день сделал с обещаниями клиентам.
 *
 * Дату контакта используют как служебную галочку: переносят пачками на завтра,
 * копят по несколько десятков на одну дату. Пока это видно только в базе, ничего
 * не меняется — поэтому вечером показываем самому менеджеру. Без выговоров:
 * цифры и один вопрос, который стоит себе задать.
 */
export function formatContactDates(d: ContactDates, dailyTarget: number): string | null {
    // Две передвинутых даты — это работа, а не проблема. Блок появляется, когда
    // есть о чём говорить: пачка переносов, просроченные обещания или день
    // впереди, в который человек уже не помещается. Иначе каждый вечер каждому
    // приходит один и тот же абзац, и его перестают читать.
    const worthSaying =
        d.movedToday >= Math.max(5, Math.round(dailyTarget / 3)) ||
        d.overdue > 0 ||
        d.peakCount > dailyTarget;
    if (!worthSaying) return null;

    const lines = ['📅 Даты следующего контакта'];

    if (d.movedToday > 0) {
        lines.push(
            d.movedByDay > 0
                ? `Сегодня передвинуто дат: ${d.movedToday}, из них на завтра — ${d.movedByDay}.`
                : `Сегодня передвинуто дат: ${d.movedToday}.`,
        );
    }
    if (d.overdue > 0) {
        lines.push(`Обещаний с прошедшей датой: ${d.overdue} — по ним разговор уже просрочен.`);
    }
    if (d.peakDate && d.peakCount > dailyTarget) {
        const day = d.peakDate.slice(8, 10) + '.' + d.peakDate.slice(5, 7);
        lines.push(
            `Самый нагруженный день впереди — ${day}: ${d.peakCount} ${plural(d.peakCount, 'заказ', 'заказа', 'заказов')}. ` +
                `Это больше, чем помещается в день (${dailyTarget}), — часть лучше развести заранее.`,
        );
    }

    lines.push('', 'Дата контакта — обещание клиенту, а не отметка «заказ не брошен». ' +
        'Если разговор не нужен — заказу место в другом статусе.');

    return lines.join('\n');
}

export function formatOwnerReport(params: {
    date: string;
    header: string;
    rows: OwnerRow[];
    invoicesToday: number;
    overdueContacts: number;
    overdueAmount: number;
    staleInvoices: number;
    /** Стадии, которые не собрались. Отчёт вышел неполным — и это должно быть видно. */
    degraded?: string[];
}): string {
    const lines = params.header ? [params.header, ''] : [];

    lines.push('По людям:');
    for (const r of params.rows) {
        const done = r.tasksTotal > 0 ? Math.round((r.tasksDone * 100) / r.tasksTotal) : 0;
        // Плана могло не быть — тогда про него молчим, а не пишем «0/0 (0%)».
        const planPart = r.tasksTotal > 0 ? `план ${r.tasksDone}/${r.tasksTotal} (${done}%), ` : '';
        lines.push(
            `${r.managerName}: ${planPart}` +
                `разговоров ${r.talks} из ${r.calls} звонков, ${r.minutes} мин` +
                (r.machine > 0 ? `, автоответчик ${r.machine}` : ''),
        );
        if (r.amountUntouched > 0) lines.push(`   не тронуто на ${money(r.amountUntouched)} ₽`);
    }

    // То, что не решается внутри отдела и требует внимания владельца.
    const attention: string[] = [];
    if (params.invoicesToday === 0) attention.push('за день не выставлено ни одного счёта');
    if (params.staleInvoices > 0) attention.push(`счетов висит без оплаты: ${params.staleInvoices}`);
    if (params.overdueContacts > 0) {
        attention.push(`просроченных обещаний перезвонить: ${params.overdueContacts} на ${money(params.overdueAmount)} ₽`);
    }

    if (attention.length > 0) lines.push('', '⚠️ Требует внимания:', ...attention.map((a) => `— ${a}`));

    // Неполный отчёт, прочитанный как полный, хуже отсутствующего: «ноль
    // звонков» и «звонки не посчитались» выглядят одинаково, а значат разное.
    if (params.degraded && params.degraded.length > 0) {
        lines.push(
            '',
            '🔧 Отчёт неполный, не собралось:',
            ...params.degraded.map((d) => `— ${d}`),
            'Остальные цифры верны. Повторный вызов крона соберёт заново.',
        );
    }

    return lines.join('\n');
}

/** Шапка вечернего отчёта: цифры дня по отделу. */
/**
 * Личный план месяца — в личное сообщение менеджеру.
 *
 * Общий план отдела человек на себя не примеряет: 13,5 млн — это «где-то там».
 * Своя цифра и остаток по рабочим дням — то, на что он может повлиять сегодня.
 * Планы (и общий, и личные) берутся из «Настройки мотивации → Планы», оттуда же,
 * откуда их берёт ведомость ЗП, — чтобы цифра была одна на всю систему.
 */
export function formatPersonalPlan(params: {
    sold: number;
    plan: number;
    workdaysLeft: number;
}): string | null {
    const { sold, plan, workdaysLeft } = params;
    if (plan <= 0) return null;

    const left = Math.max(0, plan - sold);
    const pct = Math.round((sold * 100) / plan);
    if (left === 0) return `Личный план: ${money(sold)} из ${money(plan)} ₽ (${pct}%) — выполнен ✅`;

    const perDay = workdaysLeft > 0 ? left / workdaysLeft : left;
    return (
        `Личный план: ${money(sold)} из ${money(plan)} ₽ (${pct}%)\n` +
        `Осталось ${money(left)} ₽ за ${days(workdaysLeft)} — по ${money(perDay)} ₽ в день`
    );
}

export function formatEveningHeader(params: {
    date: string;
    invoicesToday: number;
    invoicesSum: number;
    soldToday: number;
    soldSum: number;
    monthSold: number;
    monthPlan: number;
    workdaysLeft: number;
}): string {
    const { monthSold, monthPlan, workdaysLeft } = params;
    const left = Math.max(0, monthPlan - monthSold);
    const perDay = workdaysLeft > 0 ? left / workdaysLeft : left;
    const pct = monthPlan > 0 ? Math.round((monthSold * 100) / monthPlan) : 0;

    // Суммы — без НДС: план отдела и ведомость ЗП живут в этой же базе, иначе
    // цифры бота и ведомости расходятся и «не бьются» (инцидент 31.08.2026).
    return [
        `📊 Итоги дня, ${params.date} · суммы без НДС`,
        `Счетов выставлено: ${params.invoicesToday} на ${money(params.invoicesSum)} ₽`,
        `Ушло в производство: ${params.soldToday} на ${money(params.soldSum)} ₽`,
        '',
        `План месяца: ${money(monthSold)} из ${money(monthPlan)} ₽ (${pct}%)`,
        `Осталось ${money(left)} ₽ за ${days(workdaysLeft)} — по ${money(perDay)} ₽ в день`,
    ].join('\n');
}
