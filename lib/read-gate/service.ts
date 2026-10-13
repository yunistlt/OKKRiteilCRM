import { supabase } from '@/utils/supabase';
import { loadReadGateSettings, requiredSeconds, type ReadGateSettings } from '@/lib/read-gate/settings';
import { pendingDocument, type GateDocument } from '@/lib/read-gate/documents';
export { DEFER_REASONS } from '@/lib/read-gate/constants';

// ============================================================================
// Шлюз чтения: сервер решает, открыта ли человеку работа.
//
// Правило одно и оно здесь: доступ открывается, когда документ пролистан до
// конца И набрано нужное время с открытой вкладкой. Страница может отрисовать
// кнопку хоть из консоли — без этих двух условий в базе сервер не пустит.
// ============================================================================

export type GateRow = {
    id: number;
    doc_kind: string;
    doc_ref: string;
    user_id: string;
    required_seconds: number;
    opened_at: string | null;
    visible_seconds: number;
    scrolled_to_end: boolean;
    confirmed_at: string | null;
    deferred_at: string | null;
    defer_reason: string | null;
    defer_until: string | null;
    last_beat_at: string | null;
};

export type GateState =
    | { blocked: false; reason: 'disabled' | 'role' | 'no_document' | 'confirmed' | 'deferred' | 'ringing_call' }
    | { blocked: true; gate: GateRow; document: GateDocument; settings: ReadGateSettings };

/** Прошло ли подтверждение или действует отсрочка. */
function isOpen(row: GateRow): 'confirmed' | 'deferred' | null {
    if (row.confirmed_at) return 'confirmed';
    if (row.defer_until && new Date(row.defer_until) > new Date()) return 'deferred';
    return null;
}

/** Звонит ли сейчас телефон у этого человека. */
async function hasRingingCall(managerId: number | null): Promise<boolean> {
    if (managerId == null) return false;
    const { data: mgr } = await supabase
        .from('managers')
        .select('telphin_extension')
        .eq('id', managerId)
        .maybeSingle();
    const extension = (mgr as any)?.telphin_extension ? String((mgr as any).telphin_extension).trim() : null;

    const { data: rows } = await supabase
        .from('active_calls')
        .select('extension_number, extensions, is_queue')
        .limit(10);

    return ((rows ?? []) as any[]).some((call) => {
        if (call.is_queue) return true;
        if (!extension) return false;
        const all: string[] = Array.isArray(call.extensions) ? call.extensions : [];
        return all.includes(extension) || call.extension_number === extension;
    });
}

/**
 * Состояние шлюза для человека.
 *
 * Ничего не создаёт: это чтение, его дёргает и middleware на каждый переход.
 * Ряд заводится при первом показе документа (`openGate`).
 */
export async function gateState(
    userId: string,
    role: string,
    managerId: number | null,
): Promise<GateState> {
    const settings = await loadReadGateSettings();
    if (!settings.enabled) return { blocked: false, reason: 'disabled' };
    if (!settings.roles.includes(role)) return { blocked: false, reason: 'role' };

    const document = await pendingDocument(userId, managerId);
    // Нет документа — нет шлюза. Упал ночной джоб, вчера не было звонков —
    // работа открыта: техническая неисправность не останавливает отдел.
    if (!document) return { blocked: false, reason: 'no_document' };

    /**
     * Клиент на линии важнее разбора. Пока у человека звонит телефон, шлюз
     * пропускает его к работе: нужно открыть карточку звонящего, а не дочитывать.
     * Проверяем по данным сервера (`active_calls`), подделать это нельзя.
     */
    if (await hasRingingCall(managerId)) return { blocked: false, reason: 'ringing_call' };

    const { data } = await supabase
        .from('document_read_gate')
        .select('*')
        .eq('doc_kind', document.kind)
        .eq('doc_ref', document.ref)
        .eq('user_id', userId)
        .maybeSingle();

    const row = (data as GateRow | null) ?? null;
    if (row) {
        const open = isOpen(row);
        if (open) return { blocked: false, reason: open };
        return { blocked: true, gate: row, document, settings };
    }

    // Ряда ещё нет — человек документ не открывал: шлюз закрыт, но считать
    // нечего. Отдаём «болванку», страница заведёт ряд при показе.
    return {
        blocked: true,
        settings,
        document,
        gate: {
            id: 0,
            doc_kind: document.kind,
            doc_ref: document.ref,
            user_id: userId,
            required_seconds: requiredSeconds(document.body.length, settings),
            opened_at: null,
            visible_seconds: 0,
            scrolled_to_end: false,
            confirmed_at: null,
            deferred_at: null,
            defer_reason: null,
            defer_until: null,
            last_beat_at: null,
        },
    };
}

/** Завести (или вернуть) ряд при показе документа. */
export async function openGate(userId: string, document: GateDocument, settings: ReadGateSettings): Promise<GateRow> {
    const now = new Date().toISOString();
    const { data: existing } = await supabase
        .from('document_read_gate')
        .select('*')
        .eq('doc_kind', document.kind)
        .eq('doc_ref', document.ref)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        // Повторный заход — время не обнуляем: человек мог начать читать вчера.
        if (!(existing as any).opened_at) {
            const { data } = await supabase
                .from('document_read_gate')
                .update({ opened_at: now, last_beat_at: now })
                .eq('id', (existing as any).id)
                .select('*')
                .single();
            return data as GateRow;
        }
        // Сбрасываем точку отсчёта порции: между заходами время не идёт.
        await supabase.from('document_read_gate').update({ last_beat_at: now }).eq('id', (existing as any).id);
        return { ...(existing as GateRow), last_beat_at: now };
    }

    const { data, error } = await supabase
        .from('document_read_gate')
        .insert({
            doc_kind: document.kind,
            doc_ref: document.ref,
            user_id: userId,
            // Порог фиксируем на момент показа: поменяют настройку — человек не
            // окажется внезапно «недочитавшим».
            required_seconds: requiredSeconds(document.body.length, settings),
            opened_at: now,
            last_beat_at: now,
        })
        .select('*')
        .single();
    if (error) {
        // Гонка двух вкладок — ряд уже создан соседом.
        const { data: again } = await supabase
            .from('document_read_gate')
            .select('*')
            .eq('doc_kind', document.kind)
            .eq('doc_ref', document.ref)
            .eq('user_id', userId)
            .single();
        return again as GateRow;
    }
    return data as GateRow;
}

/**
 * Порция времени от страницы.
 *
 * Страница шлёт «прошло N секунд с открытой вкладкой» раз в десять секунд.
 * Сервер засчитывает НЕ БОЛЬШЕ, чем реально прошло с прошлой порции: иначе
 * из консоли можно отправить сразу сорок пять.
 */
export async function heartbeat(
    userId: string,
    gateId: number,
    claimedSeconds: number,
    scrolledToEnd: boolean,
): Promise<GateRow | null> {
    const { data: row } = await supabase
        .from('document_read_gate')
        .select('*')
        .eq('id', gateId)
        .eq('user_id', userId)
        .maybeSingle();
    if (!row) return null;

    const current = row as GateRow;
    if (current.confirmed_at) return current;

    const now = Date.now();
    const since = current.last_beat_at ? new Date(current.last_beat_at).getTime() : now;
    const realElapsed = Math.max(0, Math.floor((now - since) / 1000));
    // Запас в две секунды — на сетевую задержку, не больше.
    const grant = Math.max(0, Math.min(Math.floor(claimedSeconds), realElapsed + 2));

    const { data } = await supabase
        .from('document_read_gate')
        .update({
            visible_seconds: current.visible_seconds + grant,
            // Отметку «дочитал» снимать нельзя: пролистал — значит пролистал.
            scrolled_to_end: current.scrolled_to_end || scrolledToEnd,
            last_beat_at: new Date(now).toISOString(),
        })
        .eq('id', gateId)
        .select('*')
        .single();

    return (data as GateRow) ?? current;
}

/** Выполнены ли оба условия. Единственное место, где это решается. */
export function conditionsMet(row: GateRow): boolean {
    return row.scrolled_to_end && row.visible_seconds >= row.required_seconds;
}

export async function confirm(userId: string, gateId: number): Promise<{ ok: boolean; error?: string; row?: GateRow }> {
    const { data: row } = await supabase
        .from('document_read_gate')
        .select('*')
        .eq('id', gateId)
        .eq('user_id', userId)
        .maybeSingle();
    if (!row) return { ok: false, error: 'Документ не найден' };

    const current = row as GateRow;
    if (current.confirmed_at) return { ok: true, row: current };

    if (!conditionsMet(current)) {
        const left = Math.max(0, current.required_seconds - current.visible_seconds);
        return {
            ok: false,
            error: !current.scrolled_to_end
                ? 'Документ не пролистан до конца'
                : `Ещё рано: осталось ${left} секунд`,
        };
    }

    const { data } = await supabase
        .from('document_read_gate')
        .update({ confirmed_at: new Date().toISOString() })
        .eq('id', gateId)
        .select('*')
        .single();
    return { ok: true, row: data as GateRow };
}

/**
 * Отсрочка «срочное дело, прочитаю позже».
 *
 * Без неё отдел через неделю найдёт обход, и мы потеряем сам сигнал о том,
 * читают разбор или нет. Честно зафиксированная отсрочка лучше имитации чтения.
 */
export async function defer(
    userId: string,
    gateId: number,
    reason: string,
): Promise<{ ok: boolean; error?: string; until?: string }> {
    const settings = await loadReadGateSettings();

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
        .from('document_read_gate')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('deferred_at', dayStart.toISOString());

    if ((count ?? 0) >= settings.deferPerDay) {
        return { ok: false, error: 'Отсрочка на сегодня уже использована' };
    }

    const until = new Date(Date.now() + settings.deferMinutes * 60_000).toISOString();
    const { error } = await supabase
        .from('document_read_gate')
        .update({ deferred_at: new Date().toISOString(), defer_reason: reason, defer_until: until })
        .eq('id', gateId)
        .eq('user_id', userId);
    if (error) return { ok: false, error: error.message };

    return { ok: true, until };
}

/**
 * Прочитан ли обязательный документ у этого менеджера.
 *
 * Нужен боту: план дня не уходит, пока разбор не подтверждён — разбор идёт
 * ПЕРЕД планом, это прямое требование заказчика. Нечего читать или действует
 * отсрочка — план отправляется как обычно.
 */
export async function planAllowedForManager(managerId: number | null): Promise<boolean> {
    if (managerId == null) return true;

    const { data: users } = await supabase
        .from('users')
        .select('id, role')
        .eq('retail_crm_manager_id', managerId);

    const rows = (users ?? []) as Array<{ id: string; role: string }>;
    // Учётки нет — человеку нечем читать, план не держим.
    if (!rows.length) return true;

    for (const u of rows) {
        const state = await gateState(u.id, u.role, managerId);
        if (state.blocked) return false;
    }
    return true;
}
