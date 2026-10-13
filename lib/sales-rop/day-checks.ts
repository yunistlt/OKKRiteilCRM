import { supabase } from '@/utils/supabase';

// ============================================================================
// Проверки дня, которые считает КОД, а не модель.
//
// Решение владельца 07.10.2026: часть работы должна выполняться скриптами, а
// модель только анализирует. Всё, что проверяется по базе, проверяется по
// базе: это дешевле, одинаково каждый день и раскладывается до исходных
// данных по первому вопросу.
//
// Модели эти факты уходят готовыми — ей остаётся объяснить, чем это грозит, и
// дать фразу.
// ============================================================================

export type DayChecks = {
    /** Вчерашний план: сколько заказов выдали и по скольким человек дошёл. */
    plan: {
        total: number;
        touched: number;
        /** Сколько задач система реально проверила. Ноль — день не сверялся. */
        checked: number;
        missed: Array<{ number: string; client: string | null; amount: number }>;
    } | null;
    /** Клиент звонил сам несколько раз — значит, мы не перезваниваем. */
    insistent: Array<{ phone: string; times: number; minutes: number }>;
    /** По заказу был разговор, а записи в заказе нет. */
    noNote: string[];
    /**
     * Дата следующего контакта в заказе.
     *
     * Это ДИСЦИПЛИНА ЗАПИСИ, а не балл за следующий шаг: дату можно проставить
     * молча, и клиент о ней не узнает (поправка владельца 07.10.2026). Балл за
     * «следующий шаг» ставит модель по разговору — прозвучала ли договорённость
     * вслух. Код говорит только, стоит ли дата в карточке.
     */
    noNextDate: string[];
};

const dayBounds = (date: string) => ({
    from: new Date(`${date}T00:00:00+03:00`).toISOString(),
    to: new Date(`${date}T23:59:59+03:00`).toISOString(),
});

/** Выполнение вчерашнего плана: по каким заказам из выданного списка не дошли. */
async function planExecution(managerId: number, date: string) {
    const { data } = await supabase
        .from('sales_rop_task')
        .select('order_number, client, amount, touched, checked_at')
        .eq('plan_date', date)
        .eq('manager_id', managerId);

    const rows = (data ?? []) as any[];
    if (!rows.length) return null;

    return {
        total: rows.length,
        touched: rows.filter((r) => r.touched).length,
        checked: rows.filter((r) => r.checked_at).length,
        missed: rows
            .filter((r) => r.checked_at && !r.touched)
            .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
            .slice(0, 5)
            .map((r) => ({ number: String(r.order_number), client: r.client ?? null, amount: Number(r.amount ?? 0) })),
    };
}

/** Входящие с одного номера дважды и больше за день. */
function insistentCallers(calls: any[]) {
    const byPhone = new Map<string, { times: number; seconds: number }>();
    for (const c of calls) {
        if (c.direction === 'outgoing') continue;
        const phone = String(c.raw_payload?.from_username ?? c.from_number_normalized ?? '').replace(/\D/g, '');
        if (phone.length < 10) continue;
        const cur = byPhone.get(phone) ?? { times: 0, seconds: 0 };
        byPhone.set(phone, { times: cur.times + 1, seconds: cur.seconds + (c.duration_sec || 0) });
    }
    return Array.from(byPhone.entries())
        .filter(([, v]) => v.times >= 2)
        .map(([phone, v]) => ({ phone, times: v.times, minutes: Math.round(v.seconds / 60) }))
        .sort((a, b) => b.times - a.times);
}

/** По каким заказам после разговора не записали ни слова и не поставили дату. */
async function orderDiscipline(orderNumbers: string[], date: string) {
    if (!orderNumbers.length) return { noNote: [], noNextDate: [] };

    const { from, to } = dayBounds(date);
    const { data: orders } = await supabase
        .from('orders')
        .select('order_id, number, raw_payload')
        .in('number', orderNumbers);

    const ids = ((orders ?? []) as any[]).map((o) => Number(o.order_id));
    const { data: history } = ids.length
        ? await supabase
            .from('order_history_log')
            .select('retailcrm_order_id, field')
            .in('retailcrm_order_id', ids)
            .gte('occurred_at', from)
            .lte('occurred_at', to)
        : { data: [] as any[] };

    const noted = new Set(
        ((history ?? []) as any[])
            .filter((h) => String(h.field).includes('manager_comment'))
            .map((h) => Number(h.retailcrm_order_id)),
    );

    const noNote: string[] = [];
    const noNextDate: string[] = [];
    for (const o of ((orders ?? []) as any[])) {
        if (!noted.has(Number(o.order_id))) noNote.push(String(o.number));
        const next = o.raw_payload?.customFields?.data_kontakta;
        // Дата в прошлом — то же самое, что её нет: по такому заказу никто не
        // вернётся, он просто выпадет из планов.
        if (!next || String(next) < date) noNextDate.push(String(o.number));
    }
    return { noNote, noNextDate };
}

export async function runDayChecks(
    managerId: number,
    date: string,
    calls: any[],
    orderNumbers: string[],
): Promise<DayChecks> {
    const [plan, discipline] = await Promise.all([
        planExecution(managerId, date),
        orderDiscipline(orderNumbers, date),
    ]);
    return {
        plan,
        insistent: insistentCallers(calls),
        noNote: discipline.noNote,
        noNextDate: discipline.noNextDate,
    };
}

/** Проверки человеческим языком — в документ отдельным разделом. */
export function renderChecks(checks: DayChecks): string[] {
    const out: string[] = [];
    const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

    if (checks.plan) {
        const { total, touched, checked, missed } = checks.plan;
        /**
         * Непроверенный план — это «нет данных», а не «не сделано».
         *
         * 6 октября сверка плана не прогонялась вовсе: у всех одиннадцати задач
         * пусто в отметке проверки. Разбор написал «отработано 0 из 11» —
         * то есть обвинил человека в том, чего не знает. Закон проекта: null
         * это «не оценено», и выдавать его за ноль нельзя.
         */
        if (!checked) {
            out.push(`- Выполнение вчерашнего плана (${total} задач) система не проверяла — сверка за этот день не прогонялась.`);
        } else {
            out.push(touched >= total
                ? `- План вчерашнего дня отработан полностью: ${total} из ${total}.`
                : `- Из вчерашнего плана отработано ${touched} из ${total}.`);
            for (const m of missed) {
                out.push(`- Не дошли: заказ №${m.number}${m.client ? ` — ${m.client}` : ''} — ${rub(m.amount)}.`);
            }
        }
    }

    for (const i of checks.insistent) {
        out.push(`- Клиент ${i.phone} звонил сам ${i.times} раза, ${i.minutes} мин. Мы не перезвонили первыми.`);
    }

    if (checks.noNote.length) {
        out.push(`- Разговор был, а записи в заказе нет: №${checks.noNote.join(', №')}. Завтра никто не вспомнит, о чём договорились.`);
    }

    if (checks.noNextDate.length) {
        out.push(`- Дата следующего контакта не стоит: №${checks.noNextDate.join(', №')}. Такой заказ выпадает из планов.`);
    }

    return out;
}
