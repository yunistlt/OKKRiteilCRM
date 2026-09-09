import { supabase } from '@/utils/supabase';

/**
 * Рубильник исходящих записей в RetailCRM.
 *
 * Пока свой функционал не достроен, изменения из нашего интерфейса в RetailCRM не уходят:
 * половина логики ещё переезжает, и правка «наполовину» в чужой системе дороже, чем её
 * отсутствие. Флаг живёт в БД, чтобы включить его без выкатки кода.
 *
 * Значение в `sync_state`, ключ `retailcrm_outbound_writes`: 'enabled' | 'disabled'.
 * По умолчанию — ЗАПРЕЩЕНО: безопасная сторона, если строки нет.
 */
const KEY = 'retailcrm_outbound_writes';
const CACHE_TTL_MS = 5000;

let cache: { enabled: boolean; expiresAt: number } | null = null;

export async function isRetailcrmOutboundWriteEnabled(): Promise<boolean> {
    if (cache && cache.expiresAt > Date.now()) return cache.enabled;

    let enabled = false;
    try {
        const { data } = await supabase.from('sync_state').select('value').eq('key', KEY).maybeSingle();
        enabled = String(data?.value ?? '').trim().toLowerCase() === 'enabled';
    } catch (e) {
        // Не смогли прочитать — считаем, что писать нельзя. Молчаливая запись в чужую
        // систему хуже, чем отказ с понятным сообщением.
        console.warn('[retailcrm-outbound] Не удалось прочитать флаг, запись запрещена:', e);
        enabled = false;
    }

    cache = { enabled, expiresAt: Date.now() + CACHE_TTL_MS };
    return enabled;
}

export const RETAILCRM_WRITE_BLOCKED_MESSAGE =
    'Отправка изменений в RetailCRM пока отключена — сначала достраиваем свой функционал.';
