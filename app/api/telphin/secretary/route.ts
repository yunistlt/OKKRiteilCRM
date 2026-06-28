// AI-секретарь Телфина: узел «Интерактивная обработка» дёргает этот эндпоинт во время звонка.
// Вход: CallerIDNum (АОН), voice_navigator_DTMF (набранный номер заказа), voice_navigator_STT
//       (распознанная речь), CallID. Ветка задаётся нашим параметром ?mode=existing|new в URL,
//       прописанном в схеме Телфина. Защита: ?token=<TELPHIN_SECRETARY_TOKEN>.
// Выход: XML <Response> (SetVar добавочного + TTS). Перевод делает следующий узел схемы
//       «Перевод на номер из переменной» (имя переменной — TELPHIN_TRANSFER_VAR).
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { findOrderByNumber, getManagerById, pickLeastLoadedManager } from '@/lib/secretary/core';
import { createSecretaryLead } from '@/lib/retailcrm/leads';
import { buildResponse, xmlSetVar, xmlTTS } from '@/lib/secretary/telphin-xml';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRANSFER_VAR = process.env.TELPHIN_TRANSFER_VAR || 'transferDestination';
const FALLBACK_EXT = process.env.TELPHIN_FALLBACK_EXTENSION || '';

function xmlResponse(body: string, status = 200): NextResponse {
    return new NextResponse(body, {
        status,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

/** Считать параметры из query (GET) и тела (POST: form-urlencoded или JSON). */
async function readParams(req: NextRequest): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((v, k) => { out[k] = v; });
    if (req.method === 'POST') {
        const ct = req.headers.get('content-type') || '';
        try {
            if (ct.includes('application/json')) {
                const j = await req.json();
                for (const [k, v] of Object.entries(j || {})) out[k] = v == null ? '' : String(v);
            } else {
                const text = await req.text();
                new URLSearchParams(text).forEach((v, k) => { out[k] = v; });
            }
        } catch {
            // тело может отсутствовать — это нормально
        }
    }
    return out;
}

/** Резервный сценарий: озвучить и (если задан) перевести на общую группу/оператора. */
function fallback(message: string): string[] {
    const actions: string[] = [];
    if (FALLBACK_EXT) actions.push(xmlSetVar(TRANSFER_VAR, FALLBACK_EXT));
    actions.push(xmlTTS(message));
    return actions;
}

async function handle(req: NextRequest): Promise<NextResponse> {
    const p = await readParams(req);

    // Авторизация: общий секрет в URL (заголовки Телфин не поддерживает)
    if (process.env.TELPHIN_SECRETARY_TOKEN && p.token !== process.env.TELPHIN_SECRETARY_TOKEN) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    const mode = p.mode === 'existing' ? 'existing' : p.mode === 'new' ? 'new' : '';
    const caller = p.CallerIDNum || '';
    const dtmf = p.voice_navigator_DTMF || '';
    const stt = p.voice_navigator_STT || '';
    const callId = p.CallID || '';

    let decision = 'error';
    let orderNumber: string | null = null;
    let orderId: number | null = null;
    let managerId: number | null = null;
    let extension: string | null = null;
    let actions: string[] = [];

    try {
        if (mode === 'existing') {
            const order = await findOrderByNumber(dtmf);
            if (order && order.manager_id) {
                const m = await getManagerById(order.manager_id);
                const ext = m?.telphin_extension ? String(m.telphin_extension).trim() : '';
                if (ext) {
                    decision = 'routed_existing';
                    orderNumber = order.number;
                    orderId = order.id;
                    managerId = order.manager_id;
                    extension = ext;
                    const name = `${m?.first_name || ''} ${m?.last_name || ''}`.trim();
                    actions = [xmlSetVar(TRANSFER_VAR, ext), xmlTTS(`Соединяю вас с менеджером${name ? ` ${name}` : ''}.`)];
                } else {
                    decision = 'no_manager';
                    actions = fallback('Не удалось определить добавочный менеджера. Соединяю с оператором.');
                }
            } else {
                decision = order ? 'no_manager' : 'not_found';
                actions = fallback(order
                    ? 'У заказа не назначен менеджер. Соединяю с оператором.'
                    : 'Заказ с таким номером не найден. Соединяю с оператором.');
            }
        } else if (mode === 'new') {
            const picked = await pickLeastLoadedManager();
            const created = await createSecretaryLead({ phone: caller, summary: stt, managerId: picked?.id ?? null });
            orderNumber = created.number;
            orderId = created.id;
            if (picked) {
                decision = 'created_new';
                managerId = picked.id;
                extension = picked.extension;
                actions = [xmlSetVar(TRANSFER_VAR, picked.extension), xmlTTS(`Заявка создана. Соединяю вас с менеджером ${picked.name}.`)];
            } else {
                decision = 'created_no_manager';
                actions = fallback('Заявка создана. Свободных менеджеров сейчас нет, соединяю с оператором.');
            }
        } else {
            return xmlResponse(buildResponse([xmlTTS('Извините, произошла ошибка маршрутизации.')]));
        }
    } catch (e: any) {
        console.error('[secretary] error:', e?.message || e);
        decision = 'error';
        actions = fallback('Извините, временная ошибка. Соединяю с оператором.');
    }

    // Журнал (не должен ломать ответ звонящему)
    try {
        await supabase.from('secretary_calls').insert({
            call_id: callId || null,
            caller: caller || null,
            mode: mode || null,
            dtmf: dtmf || null,
            stt: stt || null,
            decision,
            order_number: orderNumber,
            order_id: orderId,
            manager_id: managerId,
            extension,
            raw: p,
        });
    } catch (e: any) {
        console.error('[secretary] log insert failed:', e?.message || e);
    }

    return xmlResponse(buildResponse(actions));
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
