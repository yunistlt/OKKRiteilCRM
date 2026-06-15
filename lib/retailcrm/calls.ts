// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Ингест инвентаря звонков из RetailCRM.
//
// RetailCRM отдаёт полный список звонков через GET /api/v5/telephony/calls (курсорная пагинация)
// с готовой привязкой к заказу (orderNumber) и менеджеру (добавочный + RC-id). Это:
//   1) источник истины для связки звонок→заказ (надёжнее эвристики lib/call-matching.ts);
//   2) «оракул полноты» — показывает звонки, которых нет в нашем прямом ингесте из Telphin.
// Аудио RetailCRM НЕ отдаёт — оно тянется из Telphin; стыковка по record_uuid (часть externalId).
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY;
const RETAILCRM_FETCH_TIMEOUT_MS = 15000;

const SYNC_STATE_MAX_DATE_KEY = 'retailcrm_calls_max_date';
const DEFAULT_SINCE_DAYS = 120;        // горизонт первого прогона (старее аудио в Telphin обычно протухло)
const INCREMENTAL_OVERLAP_MS = 15 * 60 * 1000; // пере-скан хвоста, чтобы ловить запоздавшие/правленые звонки
const PAGE_SAFETY_LIMIT = 400;         // backstop против бесконечного цикла
const RUN_DEADLINE_MS = 250_000;       // бюджет прогона (роут живёт 300с)

export function isRetailcrmCallsConfigured(): boolean {
    return !!(RETAILCRM_URL && RETAILCRM_API_KEY);
}

function normalizePhone(val: any): string | null {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) s = s.slice(1);
    return s.length >= 10 ? s.slice(-10) : null;
}

// RetailCRM отдаёт дату звонка в локальном времени инстанса (МСК, UTC+3). Парсим явно,
// чтобы не зависеть от таймзоны раннера. Точность даты не критична: стыковка идёт по record_uuid.
export function parseRcCallDate(raw: any): string | null {
    if (!raw) return null;
    const s = String(raw).trim().replace(' ', 'T');
    const d = new Date(/[+\-]\d\d:?\d\d$|Z$/.test(s) ? s : `${s}+03:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// externalId Телфина: "<extId>-<record_uuid>" → record_uuid (часть после первого дефиса).
export function recordUuidFromExternalId(externalId: any): string | null {
    if (!externalId) return null;
    const s = String(externalId);
    const i = s.indexOf('-');
    return (i >= 0 ? s.slice(i + 1) : s) || null;
}

async function fetchRcJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RETAILCRM_FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`RetailCRM API ${res.status}: ${text.substring(0, 200) || res.statusText}`);
        }
        return await res.json();
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error(`RetailCRM request timeout after ${RETAILCRM_FETCH_TIMEOUT_MS}ms`);
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}

function mapCall(c: any) {
    const manager = c.manager || null;
    const managerName = manager
        ? `${manager.lastName || ''} ${manager.firstName || ''}`.trim() || null
        : null;
    return {
        rc_call_id: c.id,
        external_id: c.externalId || null,
        record_uuid: recordUuidFromExternalId(c.externalId),
        call_type: c.type || null,
        call_date: parseRcCallDate(c.date),
        ext_code: c.code != null ? String(c.code) : null,
        manager_rc_id: manager?.id != null ? String(manager.id) : null,
        manager_name: managerName,
        phone: c.phone || null,
        phone_normalized: normalizePhone(c.phone),
        order_number: c.orderNumber != null ? String(c.orderNumber) : null,
        customer_rc_id: c.customer?.id != null ? String(c.customer.id) : null,
        is_missed: typeof c.isMissed === 'boolean' ? c.isMissed : null,
        duration_sec: Number.isFinite(c.duration) ? c.duration : null,
        result: c.result || null,
        raw_payload: c,
        updated_at: new Date().toISOString(),
    };
}

export interface IngestRetailcrmCallsResult {
    success: boolean;
    upserted?: number;
    pages?: number;
    floor?: string;
    newest?: string | null;
    mode?: string;
    error?: string;
}

/**
 * Тянет звонки из RetailCRM сверху вниз (новые → старые) и апсертит в retailcrm_calls.
 * Инкрементально: курсор-дата в sync_state; пере-сканируем хвост на INCREMENTAL_OVERLAP_MS.
 * @param opts.sinceDays  горизонт первого прогона (если курсора ещё нет)
 * @param opts.fullResync игнорировать сохранённый курсор и тянуть от sinceDays
 */
export async function ingestRetailcrmCalls(opts: { sinceDays?: number; fullResync?: boolean } = {}): Promise<IngestRetailcrmCallsResult> {
    if (!isRetailcrmCallsConfigured()) {
        return { success: false, error: 'RetailCRM не сконфигурирован (RETAILCRM_URL/RETAILCRM_API_KEY)' };
    }

    const base = RETAILCRM_URL!.replace(/\/+$/, '');
    const key = RETAILCRM_API_KEY!;
    const now = Date.now();

    let lastMaxMs: number | null = null;
    if (!opts.fullResync) {
        const { data } = await supabase.from('sync_state').select('value').eq('key', SYNC_STATE_MAX_DATE_KEY).maybeSingle();
        if (data?.value) {
            const t = new Date(data.value).getTime();
            if (Number.isFinite(t)) lastMaxMs = t;
        }
    }

    const sinceDays = opts.sinceDays ?? DEFAULT_SINCE_DAYS;
    const floorMs = lastMaxMs != null
        ? lastMaxMs - INCREMENTAL_OVERLAP_MS
        : now - sinceDays * 24 * 60 * 60 * 1000;

    let cursor: string | undefined;
    let pages = 0;
    let upserted = 0;
    let newestMs = lastMaxMs ?? 0;
    let reachedFloor = false;
    const deadline = now + RUN_DEADLINE_MS;

    try {
        while (pages < PAGE_SAFETY_LIMIT && Date.now() < deadline) {
            pages++;
            const url = `${base}/api/v5/telephony/calls?limit=100&apiKey=${key}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
            const data = await fetchRcJson(url);
            if (!data?.success) throw new Error(`RetailCRM telephony/calls: ${data?.errorMsg || 'неуспешный ответ'}`);

            const calls: any[] = data.calls || [];
            if (calls.length === 0) { reachedFloor = true; break; }

            const rows = calls.map(mapCall).filter(r => r.rc_call_id != null);
            const { error } = await supabase.from('retailcrm_calls').upsert(rows, { onConflict: 'rc_call_id' });
            if (error) throw error;
            upserted += rows.length;

            let oldestMs = Infinity;
            for (const r of rows) {
                if (!r.call_date) continue;
                const t = new Date(r.call_date).getTime();
                if (t > newestMs) newestMs = t;
                if (t < oldestMs) oldestMs = t;
            }

            // дошли до горизонта — дальше старые звонки, которые уже есть/не нужны
            if (oldestMs < floorMs) { reachedFloor = true; break; }

            cursor = data.pagination?.nextCursor;
            if (!cursor) { reachedFloor = true; break; }
        }

        if (newestMs > 0) {
            await supabase.from('sync_state').upsert(
                { key: SYNC_STATE_MAX_DATE_KEY, value: new Date(newestMs).toISOString(), updated_at: new Date().toISOString() },
                { onConflict: 'key' },
            );
        }

        return {
            success: true,
            upserted,
            pages,
            floor: new Date(floorMs).toISOString(),
            newest: newestMs > 0 ? new Date(newestMs).toISOString() : null,
            mode: reachedFloor ? 'caught_up' : 'partial',
        };
    } catch (e: any) {
        return { success: false, upserted, pages, error: e?.message || 'Unknown RetailCRM calls ingest error' };
    }
}
