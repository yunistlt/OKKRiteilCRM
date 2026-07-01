/**
 * Назначение менеджера на новую заявку (агент-секретарь «Катерина»).
 *
 * Правило:
 *  1) если email отправителя уже есть в нашей базе заказов → менеджер последнего заказа этого
 *     клиента, ЕСЛИ он входит в пул (email_intake_pool);
 *  2) иначе → по нагрузке: наименее загруженный менеджер пула.
 *
 * Нагрузка = число заказов менеджера в РАБОЧИХ статусах (status_settings.is_working=true),
 * за вычетом статусов из email_intake_config.load_exclude_status_codes (по умолч. «Согласование отмены»).
 * Никакого хардкода: пул и исключения — в БД.
 */
import { supabase } from '@/utils/supabase';

export interface AssignmentResult {
    managerId: number | null;
    method: 'history' | 'load' | 'none';
    reason: string; // на русском, для лога/UI
}

function normEmail(e?: string | null): string {
    return (e || '').trim().toLowerCase();
}

/**
 * Коды статусов, учитываемых в нагрузке менеджера.
 * Управляется галочкой «учитывать в нагрузке менеджера» на странице «Статусы Заказов»
 * (status_settings.is_manager_load).
 */
export async function getLoadStatusCodes(): Promise<string[]> {
    const { data } = await supabase.from('status_settings').select('code').eq('is_manager_load', true);
    return (data || []).map((r: any) => r.code);
}

/** Пул менеджеров (id) из email_intake_pool. */
export async function getManagerPool(): Promise<number[]> {
    const { data } = await supabase.from('email_intake_pool').select('manager_id');
    return (data || []).map((r: any) => Number(r.manager_id));
}

/** Дата «сегодня» в часовом поясе МСК (YYYY-MM-DD) — по ней считаем, кто сейчас в отпуске. */
function mskToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
}

/**
 * Менеджеры, которые СЕЙЧАС в отпуске/отсутствии (даты включительно).
 * Их исключаем из распределения НОВЫХ клиентов; постоянные клиенты к ним по-прежнему идут.
 */
export async function getManagersOnLeave(): Promise<number[]> {
    const t = mskToday();
    const { data } = await supabase
        .from('email_intake_absences')
        .select('manager_id')
        .lte('start_date', t)
        .gte('end_date', t);
    return (data || []).map((r: any) => Number(r.manager_id));
}

/** Все записи отпусков (для интерфейса). */
export async function getAbsences(): Promise<Array<{ id: number; manager_id: number; start_date: string; end_date: string; note: string | null }>> {
    const { data } = await supabase
        .from('email_intake_absences')
        .select('id, manager_id, start_date, end_date, note')
        .order('start_date', { ascending: false });
    return (data as any) || [];
}

/** Окно балансировки (дни) из настройки; по умолчанию 7. */
export async function getBalanceWindowDays(): Promise<number> {
    const { data } = await supabase.from('email_intake_config').select('balance_window_days').maybeSingle();
    const n = Number(data?.balance_window_days);
    return Number.isFinite(n) && n > 0 ? n : 7;
}

/**
 * Сколько заявок Катерина назначила каждому менеджеру пула за последние `days` дней.
 * Это и есть основа распределения «поровну за период» — балансируем СВОЙ поток заявок,
 * а не исторические остатки заказов. Учитываются и заявки «по истории клиента».
 */
export async function getRecentAssignmentCounts(pool: number[], days: number): Promise<Record<number, number>> {
    const counts: Record<number, number> = {};
    for (const id of pool) counts[id] = 0;
    if (pool.length === 0) return counts;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const { data } = await supabase
        .from('incoming_emails')
        .select('assigned_manager_id')
        .not('assigned_manager_id', 'is', null)
        .gte('received_at', since);
    for (const r of data || []) {
        const id = Number(r.assigned_manager_id);
        if (id in counts) counts[id]++;
    }
    return counts;
}

/** Текущая нагрузка по каждому менеджеру пула: { managerId: count активных заказов }. */
export async function getManagerLoad(pool: number[], loadCodes: string[]): Promise<Record<number, number>> {
    const load: Record<number, number> = {};
    for (const id of pool) load[id] = 0;
    if (pool.length === 0 || loadCodes.length === 0) return load;
    // Точный count по каждому менеджеру (head:true не тянет строки и не упирается в лимит 1000).
    await Promise.all(pool.map(async (id) => {
        const { count } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('manager_id', id)
            .in('status', loadCodes);
        load[id] = count || 0;
    }));
    return load;
}

/** Менеджер последнего заказа клиента по email (или null). */
export async function findOwnerByEmail(email: string): Promise<number | null> {
    const e = normEmail(email);
    if (!e) return null;
    // Точечный поиск по трём местам, где RetailCRM хранит email клиента (ilike = регистронезависимо).
    // Берём самый свежий заказ с назначенным менеджером.
    const paths = ['raw_payload->contact->>email', 'raw_payload->>email', 'raw_payload->customer->>email'];
    let best: { managerId: number; createdAt: string } | null = null;
    for (const path of paths) {
        const { data } = await supabase
            .from('orders')
            .select('manager_id, created_at')
            .not('manager_id', 'is', null)
            .ilike(path, e)
            .order('created_at', { ascending: false })
            .limit(1);
        const row = (data || [])[0] as any;
        if (row && (!best || new Date(row.created_at) > new Date(best.createdAt))) {
            best = { managerId: Number(row.manager_id), createdAt: row.created_at };
        }
    }
    return best?.managerId ?? null;
}

/**
 * Полный резолв назначения для письма-заявки.
 * Передаём заранее посчитанные pool/loadCodes/load, чтобы не дёргать БД на каждое письмо;
 * load мутируется (инкремент выбранного менеджера) — для равномерного распределения в пачке.
 */
export async function resolveAssignment(
    senderEmail: string,
    ctx: { pool: number[]; balancePool?: number[]; load: Record<number, number>; managerNames: Record<number, string> }
): Promise<AssignmentResult> {
    if (ctx.pool.length === 0) return { managerId: null, method: 'none', reason: 'Пул менеджеров пуст' };

    // 1) по истории клиента — постоянный клиент идёт к своему менеджеру ДАЖЕ если тот в отпуске
    //    (используем полный пул, а не balancePool).
    const owner = await findOwnerByEmail(senderEmail);
    if (owner && ctx.pool.includes(owner)) {
        ctx.load[owner] = (ctx.load[owner] || 0) + 1;
        return { managerId: owner, method: 'history', reason: `Клиент известен — закреплён за ${ctx.managerNames[owner] || owner}` };
    }

    // 2) поровну за период среди ДОСТУПНЫХ (balancePool = пул минус отпускники); если все в отпуске
    //    — падаем на полный пул, чтобы не оставить заявку без менеджера.
    const bp = (ctx.balancePool && ctx.balancePool.length) ? ctx.balancePool : ctx.pool;
    const least = bp.reduce((a, b) => ((ctx.load[a] ?? 0) <= (ctx.load[b] ?? 0) ? a : b));
    ctx.load[least] = (ctx.load[least] || 0) + 1;
    const base = owner ? 'история-менеджер вне пула' : 'новый клиент';
    return { managerId: least, method: 'load', reason: `Поровну за период (${base}) → ${ctx.managerNames[least] || least}` };
}

/** Имена менеджеров пула (для логов/UI). */
export async function getManagerNames(pool: number[]): Promise<Record<number, string>> {
    const names: Record<number, string> = {};
    if (pool.length === 0) return names;
    const { data } = await supabase.from('managers').select('id, first_name, last_name').in('id', pool);
    for (const m of data || []) {
        names[Number(m.id)] = [m.first_name, m.last_name].filter(Boolean).join(' ') || String(m.id);
    }
    return names;
}
