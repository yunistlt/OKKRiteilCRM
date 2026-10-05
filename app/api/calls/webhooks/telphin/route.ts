/**
 * События телефонии Телфина: звонок идёт ПРЯМО СЕЙЧАС.
 *
 * Разделение владельца 05.10.2026: звонок — событие, происходящее сейчас;
 * запись звонка — результат уже произошедшего. Этот маршрут принимает первое.
 *
 * Почему он понадобился. Входящий звонок идёт мимо нас: Телфин маршрутизирует
 * его сразу на аппарат менеджера, браузер в цепочке не участвует (телефонии в
 * нём нет вовсе — наш «софтфон» это пульт, он просит Телфин позвонить на
 * добавочный). Узнать о звонке можно только так: Телфин сообщает нам сам.
 * Обработчик для этого был написан давно, но лежал в файле `incoming.ts`, а
 * Next.js публикует маршрут только из `route.ts` — адрес отвечал 404, и
 * события падали в пустоту.
 *
 * Формат события Телфин может прислать по-разному (разные версии и типы
 * подписок), поэтому читаем терпимо: берём то, что нашли, а сырое тело
 * сохраняем в журнал — по нему видно, что реально приходит.
 *
 * Адрес для личного кабинета Телфина:
 *     https://<наш домен>/api/calls/webhooks/telphin
 * Если задан TELPHIN_WEBHOOK_SECRET, он проверяется в заголовке
 * `X-Webhook-Secret` или в параметре `?secret=`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { callIsRinging, callStopped } from '@/lib/calls/active-call';

export const dynamic = 'force-dynamic';

/** Телефон звонит / подняли трубку / всё закончилось. */
type CallPhase = 'ringing' | 'answered' | 'ended' | 'unknown';

const first = (...values: any[]): string | null => {
    for (const value of values) {
        const text = value === null || value === undefined ? '' : String(value).trim();
        if (text) return text;
    }
    return null;
};

/** Что за событие пришло: Телфин называет его по-разному в разных подписках. */
function phaseOf(payload: any): CallPhase {
    const raw = String(
        payload?.event ?? payload?.event_type ?? payload?.type ?? payload?.status ?? payload?.state ?? '',
    ).toLowerCase();

    if (/ring|incoming|invite|new_call|dial/.test(raw)) return 'ringing';
    if (/answer|bridge|connect|talk/.test(raw)) return 'answered';
    if (/hangup|end|complete|finish|disconnect|cancel|miss|fail|busy|no_answer/.test(raw)) return 'ended';
    return 'unknown';
}

function directionOf(payload: any): 'incoming' | 'outgoing' {
    const raw = String(payload?.flow ?? payload?.direction ?? payload?.call_flow ?? '').toLowerCase();
    return /out/.test(raw) ? 'outgoing' : 'incoming';
}

function authorized(req: NextRequest): boolean {
    const secret = process.env.TELPHIN_WEBHOOK_SECRET?.trim();
    if (!secret) return true; // Не настроено — принимаем, иначе события потеряются молча.

    const fromHeader = req.headers.get('x-webhook-secret')?.trim();
    const fromQuery = new URL(req.url).searchParams.get('secret')?.trim();
    return fromHeader === secret || fromQuery === secret;
}

export async function POST(req: NextRequest) {
    if (!authorized(req)) {
        return NextResponse.json({ error: 'Неверный ключ' }, { status: 401 });
    }

    let payload: any = {};
    try {
        payload = await req.json();
    } catch {
        // Телфин может прислать форму вместо JSON — разберём и её.
        try {
            const form = await req.formData();
            payload = Object.fromEntries(form.entries());
        } catch {
            payload = {};
        }
    }

    const callId = first(payload.call_uuid, payload.call_id, payload.callId, payload.uuid, payload.id);
    const phase = phaseOf(payload);

    /**
     * Сырое событие сохраняем всегда — даже непонятное. По журналу видно, что
     * Телфин присылает на самом деле, и формат можно уточнить, не гадая.
     */
    await supabase.from('telphin_webhook_log').insert([{
        call_id: callId,
        phase,
        payload,
    }]).then(() => undefined, () => undefined);

    if (!callId) {
        return NextResponse.json({ ok: true, ignored: 'нет идентификатора звонка' });
    }

    const fromNumber = first(payload.from_number, payload.ani_number, payload.from, payload.caller, payload.from_username);
    const toNumber = first(payload.to_number, payload.dest_number, payload.to, payload.called, payload.to_username);
    const extension = first(payload.extension_name, payload.extension, payload.extension_id, payload.ext);

    try {
        if (phase === 'ringing') {
            await callIsRinging({
                callId,
                direction: directionOf(payload),
                fromNumber,
                toNumber,
                extension,
                startedAt: first(payload.start_time_gmt, payload.init_time_gmt, payload.timestamp) ?? undefined,
            });
        } else if (phase === 'answered') {
            await callStopped(callId, 'answered');
        } else if (phase === 'ended') {
            await callStopped(callId, 'ended');
        }
    } catch (e: any) {
        console.error('[telphin-webhook] событие не обработалось:', e?.message);
        // Телфину отвечаем 200: иначе он будет слать повторы и забьёт очередь.
    }

    return NextResponse.json({ ok: true, callId, phase });
}

/** Проверка живости: по этому адресу удобно убедиться, что маршрут поднят. */
export async function GET() {
    return NextResponse.json({ ok: true, hint: 'Адрес для событий Телфина. Ждёт POST.' });
}
