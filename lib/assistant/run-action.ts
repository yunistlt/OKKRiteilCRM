import { supabase } from '@/utils/supabase';
import { sendOrderEmail } from '@/lib/email';
import { initiateManagerOutgoingCall } from '@/lib/telphin';

/**
 * Выполнение подтверждённого действия помощника.
 *
 * Сюда попадают только те действия, которые менеджер увидел и подтвердил нажатием.
 * Модель вызвать это не может — у неё есть лишь инструменты подготовки.
 */
export async function runAssistantAction(actionId: string, managerId: number): Promise<{
    ok: boolean;
    message: string;
}> {
    const { data: action } = await supabase
        .from('assistant_actions')
        .select('*')
        .eq('id', actionId)
        .maybeSingle();

    if (!action) return { ok: false, message: 'Действие не найдено.' };

    // Чужое действие выполнить нельзя: письмо уйдёт от имени владельца, звонок поднимет
    // его аппарат.
    if (Number(action.manager_id) !== Number(managerId)) {
        return { ok: false, message: 'Это действие подготовлено для другого менеджера.' };
    }

    if (action.status !== 'pending') {
        return { ok: false, message: `Действие уже обработано: ${humanStatus(action.status)}.` };
    }

    const payload = action.payload || {};

    try {
        if (action.kind === 'email') {
            const result = await sendOrderEmail({
                to: payload.to,
                orderNumber: payload.orderNumber,
                subjectText: payload.subject,
                html: textToHtml(payload.body),
            });

            if (!result.sent) {
                await finish(actionId, 'failed', null, result.error || 'smtp_failed');
                return {
                    ok: false,
                    message: result.error === 'smtp_not_configured'
                        ? 'Почта не настроена в этом окружении — письмо не ушло. Отправка работает только с боевого сервера.'
                        : 'Письмо не удалось отправить.',
                };
            }

            await finish(actionId, 'done', {
                subject: result.subject,
                appendedToSent: result.appendedToSent,
            });

            return {
                ok: true,
                message: result.appendedToSent
                    ? 'Письмо отправлено и легло в «Отправленные» — клиент его видит, CRM привяжет к заказу.'
                    : 'Письмо отправлено, но копия не попала в «Отправленные» — в CRM оно может не появиться.',
            };
        }

        if (action.kind === 'call') {
            const result = await initiateManagerOutgoingCall({
                managerId,
                targetPhone: payload.phone,
            });

            await finish(actionId, 'done', { callId: result.callId });
            return { ok: true, message: 'Звоню вам — снимите трубку, дальше АТС наберёт клиента.' };
        }

        await finish(actionId, 'failed', null, `unknown_kind:${action.kind}`);
        return { ok: false, message: 'Неизвестный тип действия.' };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await finish(actionId, 'failed', null, message);
        return { ok: false, message: `Не удалось выполнить: ${message}` };
    }
}

export async function cancelAssistantAction(actionId: string, managerId: number): Promise<boolean> {
    const { error } = await supabase
        .from('assistant_actions')
        .update({ status: 'cancelled', decided_at: new Date().toISOString() })
        .eq('id', actionId)
        .eq('manager_id', managerId)
        .eq('status', 'pending');

    return !error;
}

async function finish(id: string, status: string, result: any = null, error: string | null = null) {
    await supabase
        .from('assistant_actions')
        .update({ status, result, error, decided_at: new Date().toISOString() })
        .eq('id', id);
}

function humanStatus(status: string): string {
    return { done: 'выполнено', cancelled: 'отменено', failed: 'не удалось выполнить' }[status] || status;
}

/** Текст письма от модели приходит абзацами — переводим в простую разметку. */
function textToHtml(text: string): string {
    const escaped = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return escaped
        .split(/\n{2,}/)
        .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}
