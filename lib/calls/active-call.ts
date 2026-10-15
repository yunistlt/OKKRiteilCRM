/**
 * Звонок, который идёт прямо сейчас.
 *
 * Разделение владельца 05.10.2026: звонок — событие, происходящее сейчас;
 * запись звонка — результат уже произошедшего. Здесь только первое: пока
 * телефон звонит, строка живёт, браузер видит её через Realtime и показывает
 * окно. Как только разговор начался или звонок сорвался — строка гаснет, а всё
 * остальное (запись, расшифровка, оценка) живёт своей жизнью в
 * `raw_telphin_calls`.
 */
import { supabase } from '@/utils/supabase';
import { clientByPhone, existingBinding, ordersByPhone } from '@/lib/call-binding';

/**
 * Короткий номер добавочного: Телфин присылает «12037*120@corp.telphin.ru», а в
 * карточке менеджера записано просто «120».
 */
export function extensionNumber(value: any): string | null {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const afterStar = text.includes('*') ? text.split('*').pop()! : text;
    const digits = afterStar.split('@')[0].replace(/\D/g, '');
    return digits || null;
}

export type RingingCall = {
    callId: string;
    direction?: 'incoming' | 'outgoing';
    fromNumber?: string | null;
    toNumber?: string | null;
    /** Добавочный, на который звонят: по нему понятно, чей это телефон. */
    extension?: string | null;
    startedAt?: string | null;
    /**
     * Нога звонка (SubCallID Телфина): нога клиента и по ноге на каждый
     * добавочный очереди. По ним видно, идёт ли звонок ещё — см. `callLegEnded`.
     */
    legId?: string | null;
};

/**
 * Телефон зазвонил: записываем звонок и всё, что о нём уже известно.
 *
 * Кто звонит и по какому заказу выясняем здесь же, за те секунды, пока идёт
 * гудок: привязка (если её уже сделали), иначе карточка клиента по номеру и его
 * заказы. Угадывать заказ не пытаемся — если открытых заказов несколько, в окне
 * будет имя клиента и предложение выбрать заказ.
 */
export async function callIsRinging(call: RingingCall): Promise<void> {
    const callId = String(call.callId).toUpperCase();
    const direction = call.direction ?? 'incoming';
    const clientPhone = direction === 'incoming' ? call.fromNumber : call.toNumber;

    const [bound, who] = await Promise.all([
        existingBinding(callId),
        clientPhone ? clientByPhone(clientPhone) : Promise.resolve(null),
    ]);

    let orderId: number | null = bound?.orderId ?? null;
    let orderNumber: string | null = null;
    let managerId: number | null = null;

    /**
     * Чей это телефон. Окно показываем хозяину добавочного, а не всем подряд
     * (решение владельца 05.10.2026). Добавочный, который не принадлежит
     * никому, — это очередь: там телефон звонит у нескольких сразу, и окно
     * видят все.
     */
    const ext = extensionNumber(call.extension);
    let isQueue = false;
    if (ext) {
        const { data: owner } = await supabase
            .from('managers')
            .select('id')
            .eq('telphin_extension', ext)
            .limit(1);
        isQueue = !((owner ?? []) as any[]).length;
    }

    // Заказа ещё нет — смотрим, нет ли у клиента единственного открытого: тогда
    // менеджер сразу увидит, по чему звонят.
    if (!orderId && clientPhone) {
        const orders = await ordersByPhone(clientPhone, 20);
        if (orders.length === 1) orderId = orders[0].orderId;
    }

    if (orderId) {
        const { data } = await supabase
            .from('orders')
            .select('number, manager_id')
            .eq('id', orderId)
            .maybeSingle();
        orderNumber = (data as any)?.number ?? null;
        managerId = (data as any)?.manager_id ?? null;
    }

    /**
     * Перевод по внутреннему: Телфин шлёт новое событие с тем же звонком, но
     * другим добавочным. Копим список — окно видят и тот, кому звонили, и тот,
     * на кого перевели (решение владельца 05.10.2026).
     */
    const { data: known } = await supabase
        .from('active_calls')
        .select('extensions, legs')
        .eq('telphin_call_id', callId)
        .maybeSingle();

    const extensions = Array.from(new Set([
        ...(((known as any)?.extensions ?? []) as string[]),
        ...(ext ? [ext] : []),
    ]));

    /**
     * Открытые ноги звонка. Телфин шлёт `dial-*` на каждую отдельно, и на
     * каждую же отдельно присылает `hangup`. Пока хоть одна нога открыта —
     * звонок идёт, и окно висит (решение владельца 15.10.2026).
     */
    const legs = Array.from(new Set([
        ...(((known as any)?.legs ?? []) as string[]),
        ...(call.legId ? [String(call.legId)] : []),
    ]));

    await supabase.from('active_calls').upsert([{
        telphin_call_id: callId,
        direction,
        from_number: call.fromNumber ?? null,
        to_number: call.toNumber ?? null,
        extension: call.extension ?? null,
        extension_number: ext,
        extensions,
        is_queue: isQueue,
        legs,
        manager_id: managerId,
        client_name: who?.name ?? null,
        client_id: who?.clientId ?? null,
        order_id: orderId,
        order_number: orderNumber,
        status: 'ringing',
        started_at: call.startedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }], { onConflict: 'telphin_call_id' });
}

/** Трубку подняли: окно остаётся и пишет «Разговор идёт». */
export async function callStopped(callId: string, status: 'answered' | 'ended' = 'ended'): Promise<void> {
    const key = String(callId).toUpperCase();

    if (status === 'answered') {
        await supabase
            .from('active_calls')
            .update({ status: 'answered', updated_at: new Date().toISOString() })
            .eq('telphin_call_id', key);
        return;
    }

    await supabase.from('active_calls').delete().eq('telphin_call_id', key);
}

/**
 * Отбилась одна нога звонка.
 *
 * Жалоба владельца 15.10.2026: «время отображения попапа звонка надо на время
 * длительности звонка». Окно гасло на ПЕРВОМ же `hangup`, а их у одного звонка
 * столько, сколько ног: клиент плюс каждый добавочный очереди. На живом
 * входящем 15.10.2026 (разговор 17,6 с) окно прожило шесть секунд — его убил
 * отбой добавочного 103, который просто не снял трубку.
 *
 * Теперь звонок считается законченным, когда:
 *   • отбилась нога, которая РАЗГОВАРИВАЛА (`talked`) — это конец разговора;
 *   • либо закрылась последняя открытая нога — никто так и не взял трубку.
 *
 * Ноги, которую мы не видели в `dial-*`, в списке нет — такой `hangup`
 * трогает только разговаривавшую ветку, иначе окно осталось бы висеть.
 */
export function callAfterLegEnded(
    legs: string[],
    legId: string | null,
    talked: boolean,
): { done: boolean; left: string[] } {
    // Разговор закончился — окно гаснет, сколько бы ног ни оставалось открытыми.
    if (talked) return { done: true, left: [] };

    /**
     * Ног не знаем вовсе (старый формат события без `SubCallID`) — ведём себя
     * как раньше: отбой гасит окно. Лучше погасить рано, чем оставить висеть
     * навсегда.
     */
    if (!legs.length || !legId) return { done: true, left: [] };

    const left = legs.filter((leg) => leg !== String(legId));

    // Открытых ног не осталось — звонок кончился, никто не взял трубку.
    if (!left.length) return { done: true, left: [] };

    // Звонок идёт дальше на других ногах: окно висит.
    return { done: false, left };
}

export async function callLegEnded(callId: string, legId: string | null, talked: boolean): Promise<void> {
    const key = String(callId).toUpperCase();

    if (talked) {
        await supabase.from('active_calls').delete().eq('telphin_call_id', key);
        return;
    }

    const { data: known } = await supabase
        .from('active_calls')
        .select('legs')
        .eq('telphin_call_id', key)
        .maybeSingle();

    // Строки уже нет — гасить нечего.
    if (!known) return;

    const { done, left } = callAfterLegEnded(((known as any).legs ?? []) as string[], legId, talked);

    if (done) {
        await supabase.from('active_calls').delete().eq('telphin_call_id', key);
        return;
    }

    await supabase
        .from('active_calls')
        .update({ legs: left, updated_at: new Date().toISOString() })
        .eq('telphin_call_id', key);
}

/**
 * Сколько звонок может считаться идущим.
 *
 * Гудок идёт 20–30 секунд: строка `ringing` старше двух минут — это не звонок,
 * а след от события, на которое Телфин не прислал завершение. Разговор бывает
 * долгим, поэтому `answered` держим полчаса.
 */
const RINGING_TTL_MS = 2 * 60 * 1000;
const ANSWERED_TTL_MS = 30 * 60 * 1000;

/** Граница «идёт сейчас» для статуса: раньше неё звонок показывать нельзя. */
export function activeSince(status: string | null | undefined, now = Date.now()): string {
    return new Date(now - (status === 'answered' ? ANSWERED_TTL_MS : RINGING_TTL_MS)).toISOString();
}

/**
 * Звонок ещё идёт?
 *
 * Срок жизни строки меряем не только статусом. Входящий звонок Телфин может
 * провести вообще без события `answer` — живой звонок 15.10.2026 шёл от
 * `dial-in` сразу к `hangup`, — и по статусу он до конца выглядел как гудок.
 * Поэтому: есть открытые ноги или статус «разговор» — меряем разговором
 * (полчаса), иначе гудком (две минуты).
 */
export function callStillFresh(
    row: { status?: string | null; started_at?: string | null; legs?: string[] | null },
    now = Date.now(),
): boolean {
    if (!row.started_at) return false;
    const talking = row.status === 'answered' || Boolean(row.legs?.length);
    return String(row.started_at) >= activeSince(talking ? 'answered' : 'ringing', now);
}

/**
 * Зависшие звонки: Телфин не всегда присылает событие о завершении, и строка
 * остаётся висеть.
 *
 * Жалоба Евгении Матвеевой 13.10.2026: окна уже прошедших звонков выскакивали
 * при каждом действии — в таблице лежали строки с 8 октября. Функция была
 * написана, но её никто не вызывал; теперь её зовёт маршрут окна звонка.
 */
export async function dropStaleCalls(): Promise<number> {
    const now = Date.now();

    const { data: rows } = await supabase
        .from('active_calls')
        .select('telphin_call_id, status, started_at, legs')
        .limit(200);

    const stale = ((rows ?? []) as any[])
        .filter((row) => !callStillFresh(row, now))
        .map((row) => String(row.telphin_call_id));

    if (!stale.length) return 0;

    await supabase.from('active_calls').delete().in('telphin_call_id', stale);
    return stale.length;
}
