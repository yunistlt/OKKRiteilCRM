import { supabase } from '@/utils/supabase';

/**
 * Рубильник на ЧТЕНИЕ из RetailCRM.
 *
 * Решение владельца 09.10.2026: «нам надо уже отвязаться от ритейла и жить
 * полностью в ОКК; если что-то будет — докачаем». Автоматические синхронизации
 * сняты с расписания, но маршруты остались: их зовут руками, когда нужно
 * что-то дотянуть. Чтобы случайный или забытый вызов не перезаписал нашу
 * работу снимком из чужой системы, каждый такой маршрут спрашивает этот флаг.
 *
 * Почему это важнее, чем кажется. Снимок из RetailCRM перезаписывает
 * `raw_payload` заказа целиком. Всё, что менеджер внёс у нас и что в CRM не
 * ушло, таким снимком стирается — именно так пропадали банковские реквизиты и
 * комментарии (жалобы Евгении Матвеевой 09.10.2026: «программа своей жизнью
 * живёт — что-то сохранила, что-то нет»).
 *
 * Значение живёт в `sync_state` под ключом `retailcrm_inbound_sync`:
 * «enabled» — читать можно, что угодно другое или пусто — нельзя.
 */
const KEY = 'retailcrm_inbound_sync';
const CACHE_MS = 60_000;

let cache: { enabled: boolean; expiresAt: number } | null = null;

export const RETAILCRM_READ_BLOCKED_MESSAGE =
    'Синхронизация с RetailCRM выключена: мы живём в ОКК. Включить разово можно ключом '
    + '`retailcrm_inbound_sync` в таблице `sync_state`.';

export async function isRetailcrmInboundSyncEnabled(): Promise<boolean> {
    if (cache && cache.expiresAt > Date.now()) return cache.enabled;

    let enabled = false;
    try {
        const { data } = await supabase.from('sync_state').select('value').eq('key', KEY).maybeSingle();
        enabled = String((data as any)?.value ?? '').trim().toLowerCase() === 'enabled';
    } catch (e) {
        // Не прочитали — считаем, что нельзя: молча перезаписать свои данные
        // чужим снимком хуже, чем отказать с понятным сообщением.
        console.warn('[retailcrm-inbound] Не удалось прочитать флаг, чтение запрещено:', e);
        enabled = false;
    }

    cache = { enabled, expiresAt: Date.now() + CACHE_MS };
    return enabled;
}

/** Сбросить кэш — после правки флага в интерфейсе. */
export function clearRetailcrmInboundCache() {
    cache = null;
}
