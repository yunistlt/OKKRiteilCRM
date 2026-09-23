import { supabase } from '@/utils/supabase';

/**
 * Недельный разбор нагрузки: кому можно дать больше работы, а кому нельзя.
 *
 * Раньше ответ на этот вопрос собирался руками из четырёх экранов, и каждый раз
 * по-разному. Теперь его считает бот по одной методике и приносит сам.
 *
 * Главное правило методики: работой считается не отметка в карточке, а внешний
 * след — звонок, письмо, ответ клиента, движение заказа, деньги. Менеджер,
 * закрывающий задачи комментариями, формально отрабатывает сто процентов, и
 * поднимать ему нагрузку — значит получить вдвое больше комментариев.
 *
 * Рекомендация не применяется сама. Она уходит предложением, которое владелец
 * подтверждает нажатием: нагрузка — это про людей, и решение здесь его.
 */

export type ManagerWeek = {
    managerId: number;
    name: string;
    workDays: number;
    tasksIssued: number;
    tasksTouched: number;
    tasksCommentOnly: number;
    tasksConfirmed: number;
    tasksReplied: number;
    tasksMoved: number;
    tasksMoney: number;
    tasksClosedUnconfirmed: number;
    calls: number;
    callMinutes: number;
    emails: number;
    productionCount: number;
    productionAmount: number;
    /** Доли — то, по чему принимается решение. */
    touchedRate: number;
    commentOnlyRate: number;
    confirmedRate: number;
    movementRate: number;
    /** Личный множитель сейчас. Пусто — как у отдела. */
    personalFactor: number | null;
    absent: boolean;
};

export type LoadRecommendation = {
    action: 'increase' | 'keep' | 'decrease' | 'hold_until_more_data' | 'check_quality_first' | 'check_task_shortage';
    title: string;
    reason: string;
    /** Предлагаемый личный множитель. null — менять не надо. */
    suggestedFactor: number | null;
};

/** Сколько полных рабочих дней нужно, чтобы вообще делать вывод. */
const MIN_WORK_DAYS = 3;

/** Шаг повышения. Больше — уже не настройка, а перестановка работы человека. */
const STEP = 0.1;

/** Выше этого доля «закрыто комментарием» означает, что цифра отработки ничего не значит. */
const COMMENT_ONLY_ALARM = 0.3;

/**
 * Рекомендация по одному человеку.
 *
 * Порядок проверок важен: сначала то, что запрещает вывод вовсе (нет данных),
 * потом то, что запрещает повышение (качество), и только в конце — само
 * повышение. Иначе человек с идеальной отработкой и одними комментариями
 * получил бы прибавку первым.
 */
export function recommend(m: ManagerWeek): LoadRecommendation {
    const current = m.personalFactor ?? 1;

    if (m.absent) {
        return {
            action: 'hold_until_more_data',
            title: 'решение отложено',
            reason: 'человек отсутствовал часть недели — сравнивать его с работавшими не с чем',
            suggestedFactor: null,
        };
    }
    if (m.workDays < MIN_WORK_DAYS || m.tasksIssued === 0) {
        return {
            action: 'hold_until_more_data',
            title: 'мало данных',
            reason: `полных рабочих дней ${m.workDays}, задач ${m.tasksIssued} — этого мало для вывода`,
            suggestedFactor: null,
        };
    }

    // Качество раньше количества. Отработка 100% из одних комментариев — это не
    // работа, а способ закрыть список.
    if (m.commentOnlyRate >= COMMENT_ONLY_ALARM) {
        return {
            action: 'check_quality_first',
            title: 'сначала разобраться с качеством',
            reason:
                `${Math.round(m.commentOnlyRate * 100)}% задач закрыто комментарием без звонка и письма` +
                (m.tasksClosedUnconfirmed > 0 ? `, из них ${m.tasksClosedUnconfirmed} — отказ без разговора с клиентом` : '') +
                '. Добавлять работу тому, кто закрывает её записями, значит получить вдвое больше записей',
            suggestedFactor: null,
        };
    }

    // Недобор задач — вопрос к алгоритму, а не к человеку.
    const perDay = m.tasksIssued / Math.max(1, m.workDays);
    if (m.touchedRate >= 0.9 && perDay < 5) {
        return {
            action: 'check_task_shortage',
            title: 'бот недодаёт задач',
            reason: `в среднем ${perDay.toFixed(1)} задач в день при хорошей отработке — подходящих заказов мало, дело не в человеке`,
            suggestedFactor: null,
        };
    }

    if (m.touchedRate < 0.7) {
        const next = Math.max(0.5, Math.round((current - STEP) * 100) / 100);
        return {
            action: 'decrease',
            title: 'снизить',
            reason: `отработано ${Math.round(m.touchedRate * 100)}% задач — список больше, чем человек успевает`,
            suggestedFactor: next === current ? null : next,
        };
    }

    if (m.touchedRate >= 0.95 && m.confirmedRate >= 0.5 && m.movementRate > 0) {
        const next = Math.min(2, Math.round((current + STEP) * 100) / 100);
        return {
            action: 'increase',
            title: 'можно поднять',
            reason:
                `отработано ${Math.round(m.touchedRate * 100)}%, ` +
                `подтверждённый контакт по ${Math.round(m.confirmedRate * 100)}% задач, ` +
                `${m.tasksMoved} заказов сдвинулось`,
            suggestedFactor: next === current ? null : next,
        };
    }

    return {
        action: 'keep',
        title: 'оставить как есть',
        reason:
            `отработано ${Math.round(m.touchedRate * 100)}%, подтверждённый контакт по ` +
            `${Math.round(m.confirmedRate * 100)}% задач — до повышения не дотягивает, снижать не за что`,
        suggestedFactor: null,
    };
}

/**
 * Понедельник и воскресенье прошлой недели.
 *
 * Разбор идёт в понедельник утром и смотрит на прошлую ПОЛНУЮ неделю: «неделя
 * по сегодня» в понедельник — это один день, и вывода о человеке из него нет.
 */
export function lastWeek(today: string): { from: string; to: string } {
    const d = new Date(`${today}T00:00:00.000Z`);
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - dow - 6);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/** Неделя по каждому менеджеру. Даты включительно, формат ГГГГ-ММ-ДД. */
export async function loadWeek(from: string, to: string): Promise<ManagerWeek[]> {
    const { data: stats, error } = await supabase
        .from('sales_rop_manager_day_stats')
        .select('*')
        .gte('work_date', from)
        .lte('work_date', to);
    if (error) throw new Error(error.message);

    const [{ data: people }, { data: ropManagers }, { data: absences }] = await Promise.all([
        supabase.from('managers').select('id, first_name, last_name'),
        supabase.from('sales_rop_manager').select('manager_id, load_factor, is_active').eq('is_active', true),
        supabase.from('email_intake_absences').select('manager_id, start_date, end_date'),
    ]);

    const nameById = new Map(
        ((people ?? []) as any[]).map((m) => [
            Number(m.id),
            [m.last_name, m.first_name].filter(Boolean).join(' ').trim() || `#${m.id}`,
        ]),
    );
    const factorById = new Map(
        ((ropManagers ?? []) as any[]).map((r) => [
            Number(r.manager_id),
            r.load_factor === null || r.load_factor === undefined ? null : Number(r.load_factor),
        ]),
    );
    // Отсутствия ведутся для разбора почты, но отпуск один и тот же: заводить
    // второй справочник значило бы вести его в двух местах и разойтись.
    const absentIds = new Set(
        ((absences ?? []) as any[])
            .filter((a) => String(a.start_date) <= to && String(a.end_date) >= from)
            .map((a) => Number(a.manager_id)),
    );

    const byManager = new Map<number, ManagerWeek>();
    for (const row of ((stats ?? []) as any[])) {
        if (row.manager_id === null) continue;
        const id = Number(row.manager_id);
        const acc =
            byManager.get(id) ??
            ({
                managerId: id,
                name: nameById.get(id) ?? `#${id}`,
                workDays: 0,
                tasksIssued: 0,
                tasksTouched: 0,
                tasksCommentOnly: 0,
                tasksConfirmed: 0,
                tasksReplied: 0,
                tasksMoved: 0,
                tasksMoney: 0,
                tasksClosedUnconfirmed: 0,
                calls: 0,
                callMinutes: 0,
                emails: 0,
                productionCount: 0,
                productionAmount: 0,
                touchedRate: 0,
                commentOnlyRate: 0,
                confirmedRate: 0,
                movementRate: 0,
                personalFactor: factorById.get(id) ?? null,
                absent: absentIds.has(id),
            } as ManagerWeek);

        acc.workDays += 1;
        acc.tasksIssued += Number(row.tasks_issued ?? 0);
        acc.tasksTouched += Number(row.tasks_touched ?? 0);
        acc.tasksCommentOnly += Number(row.tasks_comment_only ?? 0);
        acc.tasksConfirmed += Number(row.tasks_confirmed_contact ?? 0);
        acc.tasksReplied += Number(row.tasks_client_replied ?? 0);
        acc.tasksMoved += Number(row.tasks_order_moved ?? 0);
        acc.tasksMoney += Number(row.tasks_money_result ?? 0);
        acc.tasksClosedUnconfirmed += Number(row.tasks_closed_unconfirmed ?? 0);
        acc.calls += Number(row.calls_count ?? 0);
        acc.callMinutes += Math.round(Number(row.call_seconds ?? 0) / 60);
        acc.emails += Number(row.emails_count ?? 0);
        acc.productionCount += Number(row.production_count ?? 0);
        acc.productionAmount += Number(row.production_amount ?? 0);
        byManager.set(id, acc);
    }

    for (const m of Array.from(byManager.values())) {
        const total = Math.max(1, m.tasksIssued);
        m.touchedRate = m.tasksTouched / total;
        m.commentOnlyRate = m.tasksCommentOnly / total;
        m.confirmedRate = m.tasksConfirmed / total;
        m.movementRate = m.tasksMoved / total;
    }

    return Array.from(byManager.values()).sort((a, b) => b.tasksIssued - a.tasksIssued);
}

const money = (v: number) => Math.round(v).toLocaleString('ru-RU');

/** Сообщение владельцу: таблица по каждому и рекомендация. */
export function formatWeekReview(from: string, to: string, weeks: ManagerWeek[]): string {
    if (weeks.length === 0) return `Разбор нагрузки за ${from} — ${to}: задач за период не было.`;

    const lines = [`📊 Разбор нагрузки за ${from} — ${to}`, ''];

    for (const m of weeks) {
        const rec = recommend(m);
        lines.push(`${m.name}${m.absent ? ' (отсутствовал(а) часть недели)' : ''}`);
        lines.push(
            `   дней ${m.workDays} · выдано ${m.tasksIssued} · отработано ${m.tasksTouched} ` +
                `(${Math.round(m.touchedRate * 100)}%)`,
        );
        lines.push(
            `   разговоров по задачам ${m.tasksConfirmed} · клиент ответил ${m.tasksReplied} · ` +
                `заказ сдвинулся ${m.tasksMoved} · в производство ${m.productionCount}` +
                (m.productionAmount > 0 ? ` на ${money(m.productionAmount)} ₽` : ''),
        );
        // Отдельной строкой и только когда есть: это главный показатель того,
        // можно ли верить проценту отработки.
        if (m.tasksCommentOnly > 0) {
            lines.push(
                `   закрыто только комментарием: ${m.tasksCommentOnly} (${Math.round(m.commentOnlyRate * 100)}%)` +
                    (m.tasksClosedUnconfirmed > 0 ? `, отказов без разговора: ${m.tasksClosedUnconfirmed}` : ''),
            );
        }
        lines.push(
            `   звонков ${m.calls} на ${m.callMinutes} мин · писем ${m.emails} · ` +
                `нагрузка ×${m.personalFactor ?? 1}${m.personalFactor === null ? ' (общая)' : ''}`,
        );
        lines.push(`   ➡️ ${rec.title}: ${rec.reason}`);
        lines.push('');
    }

    lines.push('Нагрузку сам не меняю — предложения ждут подтверждения в Штабе.');
    return lines.join('\n');
}
