/**
 * Доставка сообщений бота в чат с Семёном.
 *
 * Советы и планы уходили в Telegram, а работают менеджеры в CRM: чтобы увидеть
 * совет по заказу, надо было переключиться в мессенджер и вернуться обратно.
 * Теперь то же сообщение приходит в чат с Семёном — там, где человек работает
 * (требование владельца 01.10.2026).
 *
 * Пишем в ту же переписку, что ведёт сам Семён (`okk_consultant_threads` /
 * `okk_consultant_messages`), отдельной веткой «Бот-РОП». Своего хранилища не
 * заводим: иначе в панели было бы два чата с разным устройством.
 */
import { supabase } from '@/utils/supabase';

/**
 * Раздел, в котором живёт ветка бота.
 *
 * Секции консультанта привязаны к экранам; бот пишет ночью, когда экрана нет,
 * поэтому кладём в раздел по умолчанию — тот, что открыт в панели почти везде.
 */
const SECTION_KEY = 'quality-dashboard';
const BRANCH_KEY = `scope:${SECTION_KEY}:global:sales-rop`;
const THREAD_TITLE = 'Бот-РОП: планы и советы';

/** Кому пишем: наш пользователь, привязанный к менеджеру RetailCRM. */
async function userOfManager(managerId: number): Promise<{ id: string; username: string } | null> {
    const { data } = await supabase
        .from('users')
        .select('id, username')
        .eq('retail_crm_manager_id', managerId)
        .limit(1)
        .maybeSingle();

    if (!data) return null;
    return { id: String((data as any).id), username: String((data as any).username ?? '') };
}

async function threadOfUser(user: { id: string; username: string }): Promise<string | null> {
    const { data: existing } = await supabase
        .from('okk_consultant_threads')
        .select('id')
        .eq('user_id', user.id)
        .eq('branch_key', BRANCH_KEY)
        .is('archived_at', null)
        .maybeSingle();

    if (existing) return String((existing as any).id);

    const { data: created, error } = await supabase
        .from('okk_consultant_threads')
        .insert({
            user_id: user.id,
            username: user.username,
            order_id: null,
            branch_key: BRANCH_KEY,
            title: THREAD_TITLE,
        })
        .select('id')
        .single();

    if (error) {
        console.warn('[notify] Ветка бота в чате не завелась:', error.message);
        return null;
    }

    return String((created as any).id);
}

/**
 * Положить сообщение в чат менеджера с Семёном.
 *
 * Возвращает false, если доставить некуда: у менеджера нет учётной записи в
 * CRM. Вызывающий решает, слать ли тогда в Telegram.
 */
export async function deliverToConsultantChat(params: {
    managerId: number;
    text: string;
    /** Что за сообщение: план дня, вечерний разбор, совет. Видно в истории. */
    kind: string;
}): Promise<boolean> {
    const user = await userOfManager(params.managerId);
    if (!user) return false;

    const threadId = await threadOfUser(user);
    if (!threadId) return false;

    const { error } = await supabase.from('okk_consultant_messages').insert({
        thread_id: threadId,
        role: 'agent',
        // Текст приходит с разметкой ссылок для Telegram — в чате она не нужна.
        content: stripTelegramHtml(params.text),
        metadata: { source: 'sales-rop', kind: params.kind, deliveredAt: new Date().toISOString() },
    });

    if (error) {
        console.warn('[notify] Сообщение в чат не легло:', error.message);
        return false;
    }

    await supabase
        .from('okk_consultant_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId);

    return true;
}

/** Ссылки вида <a href="...">№123</a> в чате читаются как номер заказа. */
export function stripTelegramHtml(text: string): string {
    return text
        .replace(/<a\s+href="[^"]*"\s*>([^<]*)<\/a>/gi, '$1')
        .replace(/<\/?b>/gi, '')
        .replace(/<\/?i>/gi, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
