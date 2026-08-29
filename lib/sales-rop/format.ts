import type { Task } from '@/lib/sales-rop/rules';
import { days } from '@/lib/sales-rop/rules';

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
    contact_today: '🟡 Звонок сегодня',
    deal_stale: '🔵 Сделка стоит',
    big_silence: '⚪️ Крупный молчит',
    development: '🟢 Развитие клиента — что ещё предложить',
    lost: '⚫️ Потеряшка — поднять или закрыть',
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
    const live = plan.tasks.filter((t: Task) => t.reasonCode !== 'lost');
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

    const head =
        live.length > 0
            ? `${who}, план на сегодня — ${live.length} шт.`
            : `${who}, на сегодня срочного нет — разобрать архив:`;
    const lines: string[] = hello ? [hello, '', head] : [head];

    let lastReason: string | null = null;
    for (const t of plan.tasks) {
        if (t.reasonCode !== lastReason) {
            lines.push('', REASON_TITLE[t.reasonCode]);
            lastReason = t.reasonCode;
        }
        lines.push(
            `${orderLink(base, t.orderId, t.number)} — ${money(t.amount)} ₽ — ${t.client || 'клиент не указан'}`,
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

/** Шапка вечернего отчёта: цифры дня по отделу. */
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

    return [
        `📊 Итоги дня, ${params.date}`,
        `Счетов выставлено: ${params.invoicesToday} на ${money(params.invoicesSum)} ₽`,
        `Ушло в производство: ${params.soldToday} на ${money(params.soldSum)} ₽`,
        '',
        `План месяца: ${money(monthSold)} из ${money(monthPlan)} ₽ (${pct}%)`,
        `Осталось ${money(left)} ₽ за ${days(workdaysLeft)} — по ${money(perDay)} ₽ в день`,
    ].join('\n');
}
