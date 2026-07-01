/**
 * Здоровье OpenAI → системный алерт для постоянной плашки вверху интерфейса.
 * Когда у OpenAI кончается баланс (429 insufficient_quota), ИИ-функции молча ложатся
 * (разбор почты, консультанты). Раньше это оставалось незаметным и стоило потерянных заявок —
 * теперь помечаем алерт `openai_quota`, и общий layout показывает красную полоску, пока не пополнят.
 */
import { supabase } from '@/utils/supabase';

const OPENAI_QUOTA_KEY = 'openai_quota';
const QUOTA_MESSAGE =
    'Исчерпан баланс OpenAI. ИИ-функции (разбор входящей почты, ИИ-консультанты) не работают, ' +
    'пока не пополните баланс на platform.openai.com. Новые письма не теряются — они разберутся автоматически после пополнения.';

/** Ошибка = именно исчерпанный баланс/квота OpenAI (а не транзиентный сбой сети). */
export function isOpenAiQuotaError(err: any): boolean {
    const code = err?.code || err?.error?.code || err?.cause?.code;
    const type = err?.type || err?.error?.type;
    return code === 'insufficient_quota' || type === 'insufficient_quota';
}

/** Поднять алерт «исчерпан баланс OpenAI» (идемпотентно). */
export async function recordOpenAiQuotaError(err: any): Promise<void> {
    if (!isOpenAiQuotaError(err)) return;
    try {
        await supabase.from('system_alerts').upsert(
            { key: OPENAI_QUOTA_KEY, active: true, severity: 'error', message: QUOTA_MESSAGE, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );
    } catch { /* мониторинг не критичен */ }
}

/** Успешный вызов OpenAI → снять алерт квоты, если он висел. */
export async function recordOpenAiOk(): Promise<void> {
    try {
        await supabase
            .from('system_alerts')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('key', OPENAI_QUOTA_KEY)
            .eq('active', true);
    } catch { /* мониторинг не критичен */ }
}

export interface SystemAlert {
    key: string;
    message: string;
    severity: string;
}

/** Активные системные алерты для плашки в layout. */
export async function getActiveSystemAlerts(): Promise<SystemAlert[]> {
    try {
        const { data } = await supabase
            .from('system_alerts')
            .select('key, message, severity')
            .eq('active', true);
        return (data as SystemAlert[]) || [];
    } catch {
        return [];
    }
}
