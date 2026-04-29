import { supabase } from '@/utils/supabase';
import { fetchTelphin, getTelphinToken } from '@/lib/telphin';
import { safeEnqueueCallTranscriptionJob, safeEnqueueSystemJob } from '@/lib/system-jobs';

// Helper to format date for Telphin: YYYY-MM-DD HH:mm:ss
function formatTelphinDate(date: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        date.getUTCFullYear() + '-' +
        pad(date.getUTCMonth() + 1) + '-' +
        pad(date.getUTCDate()) + ' ' +
        pad(date.getUTCHours()) + ':' +
        pad(date.getUTCMinutes()) + ':' +
        pad(date.getUTCSeconds())
    );
}

// Normalization helper (Updated to strip 7/8 prefix for 10-digit standard)
function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

export interface SyncResult {
    success: boolean;
    total_synced?: number;
    new_cursor?: string;
    mode?: string;
    rule_engine_violations?: any;
    error?: string;
}

interface TelphinSyncOptions {
    storageKey: string;
    errorKey: string;
    lagKey?: string;
    source: string;
    defaultLookbackMinutes: number;
    fetchCount: number;
    forceResync?: boolean;
    hours?: number;
    modePrefix: string;
}

function getDefaultTelphinFallbackMinutes() {
    const parsed = Number.parseInt(process.env.TELPHIN_FALLBACK_MINUTES || '15', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 15;
    }
    return parsed;
}

async function recordTelphinFallbackSuccess(cursor: string) {
    const now = new Date().toISOString();
    const lagSeconds = Math.max(0, Math.floor((Date.now() - new Date(cursor).getTime()) / 1000));

    const { error } = await supabase.from('sync_state').upsert([
        {
            key: 'telphin_last_sync_time',
            value: cursor,
            updated_at: now,
        },
        {
            key: 'telphin_fallback_lag_seconds',
            value: String(lagSeconds),
            updated_at: now,
        },
        {
            key: 'telphin_fallback_last_error',
            value: '',
            updated_at: now,
        },
    ], { onConflict: 'key' });

    if (error) throw error;
}

async function recordTelphinFallbackFailure(message: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('sync_state').upsert({
        key: 'telphin_fallback_last_error',
        value: message.slice(0, 1500),
        updated_at: now,
    }, { onConflict: 'key' });

    if (error) throw error;
}

async function recordTelphinSyncSuccess(cursor: string, options: TelphinSyncOptions) {
    if (options.storageKey === 'telphin_last_sync_time') {
        await recordTelphinFallbackSuccess(cursor);
        return;
    }

    const now = new Date().toISOString();
    const entries = [
        {
            key: options.storageKey,
            value: cursor,
            updated_at: now,
        },
        {
            key: options.errorKey,
            value: '',
            updated_at: now,
        },
    ];

    if (options.lagKey) {
        const lagSeconds = Math.max(0, Math.floor((Date.now() - new Date(cursor).getTime()) / 1000));
        entries.push({
            key: options.lagKey,
            value: String(lagSeconds),
            updated_at: now,
        });
    }

    const { error } = await supabase.from('sync_state').upsert(entries, { onConflict: 'key' });
    if (error) throw error;
}

async function recordTelphinSyncFailure(message: string, options: TelphinSyncOptions) {
    if (options.errorKey === 'telphin_fallback_last_error') {
        await recordTelphinFallbackFailure(message);
        return;
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from('sync_state').upsert({
        key: options.errorKey,
        value: message.slice(0, 1500),
        updated_at: now,
    }, { onConflict: 'key' });

    if (error) throw error;
}

function getTelphinBacklogRecoveryHours() {
    const parsed = Number.parseInt(process.env.TELPHIN_BACKLOG_RECOVERY_HOURS || '24', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 24;
    }
    return parsed;
}

async function runTelphinCallHistorySync(options: TelphinSyncOptions): Promise<SyncResult> {
    const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID;
    const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET;

    if (!TELPHIN_APP_KEY || !TELPHIN_APP_SECRET) {
        return { success: false, error: 'Telphin config missing' };
    }

    try {
        const token = await getTelphinToken();
        const now = new Date();
        const maxLookbackMs = options.defaultLookbackMinutes * 60 * 1000;

        let start = new Date(Date.now() - maxLookbackMs);

        if (!options.forceResync) {
            const { data: state } = await supabase
                .from('sync_state')
                .select('value')
                .eq('key', options.storageKey)
                .single();

            if (state?.value) {
                const storedDate = new Date(state.value);
                if (storedDate < now) {
                    const boundedStart = new Date(Math.max(storedDate.getTime(), now.getTime() - maxLookbackMs));
                    start = boundedStart;
                    console.log(`[TelphinSync:${options.source}] Incremental sync from state:`, start.toISOString());
                } else {
                    console.warn(`[TelphinSync:${options.source}] Stored cursor is in the future, falling back to default window.`, state.value);
                }
            }
        } else {
            const forceHours = options.hours || Math.max(1, Math.ceil(options.defaultLookbackMinutes / 60));
            console.log(`[TelphinSync:${options.source}] Forced resync requested. Looking back ${forceHours} hours.`);
            start = new Date(Date.now() - forceHours * 60 * 60 * 1000);
        }

        const userRes = await fetchTelphin('https://apiproxy.telphin.ru/api/ver1.0/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!userRes.ok) {
            const text = await userRes.text();
            throw new Error(`Telphin user lookup failed: ${userRes.status} ${text.substring(0, 200)}`);
        }
        const userData = await userRes.json();
        const clientId = userData.client_id;
        if (!clientId) throw new Error('Could not resolve Telphin Client ID');

        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(start),
            end_datetime: formatTelphinDate(now),
            order: 'asc',
            count: String(options.fetchCount)
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
        console.log(`[TelphinSync:${options.source}] Fetching ${url}`);

        const res = await fetchTelphin(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Telphin API Error ${res.status}: ${text.substring(0, 200) || res.statusText}`);
        }

        const data = await res.json();
        const calls = data.call_history || (Array.isArray(data) ? data : []);
        console.log(`[TelphinSync:${options.source}] Fetched ${calls.length} calls.`);

        let totalSynced = 0;
        let nextCursor = start.toISOString();
        const fetchedCount = calls.length;

        if (calls.length > 0) {
            const rawCalls = calls.map((r: any) => {
                const record_uuid = r.call_uuid || r.record_uuid || `rec_${Math.random()}`;
                const rawFlow = r.flow || r.direction;

                let direction = 'unknown';
                if (rawFlow === 'out') direction = 'outgoing';
                else if (rawFlow === 'in') direction = 'incoming';
                else if (rawFlow === 'incoming' || rawFlow === 'outgoing') direction = rawFlow;

                const startedRaw = r.start_time_gmt || r.init_time_gmt || r.bridged_time_gmt;
                const callDate = startedRaw ? new Date(startedRaw + (startedRaw.includes('Z') ? '' : 'Z')) : new Date();

                let fromNumber = r.from_number || r.ani_number || r.from_username;
                let toNumber = r.to_number || r.dest_number || r.to_username;

                if (rawFlow === 'out') {
                    fromNumber = r.ani_number || r.from_number || r.from_username;
                    toNumber = r.dest_number || r.to_number || r.to_username;
                }

                let recordingUrl = r.record_url || r.storage_url || r.url || null;
                if (!recordingUrl && r.cdr && Array.isArray(r.cdr)) {
                    const cdrWithStorage = r.cdr.find((c: any) => c.storage_url);
                    if (cdrWithStorage) {
                        recordingUrl = cdrWithStorage.storage_url;
                    }
                }

                return {
                    telphin_call_id: record_uuid,
                    direction: direction,
                    from_number: fromNumber || 'unknown',
                    to_number: toNumber || 'unknown',
                    from_number_normalized: normalizePhone(fromNumber),
                    to_number_normalized: normalizePhone(toNumber),
                    started_at: callDate.toISOString(),
                    duration_sec: r.duration || 0,
                    recording_url: recordingUrl,
                    raw_payload: r,
                    ingested_at: new Date().toISOString()
                };
            });

            const { error: rawError } = await supabase.from('raw_telphin_calls')
                .upsert(rawCalls, { onConflict: 'telphin_call_id' });

            if (rawError) {
                console.error(`[TelphinSync:${options.source}] Upsert Error:`, rawError);
                throw rawError;
            }

            totalSynced = rawCalls.length;

            for (const rawCall of rawCalls) {
                await safeEnqueueSystemJob({
                    jobType: 'call_match',
                    payload: {
                        telphin_call_id: rawCall.telphin_call_id,
                        source: options.source,
                        started_at: rawCall.started_at,
                    },
                    priority: 30,
                    idempotencyKey: `call_match:${rawCall.telphin_call_id}:${options.source}`,
                });

                if (rawCall.recording_url) {
                    await safeEnqueueCallTranscriptionJob({
                        callId: rawCall.telphin_call_id,
                        source: options.source,
                        recordingUrl: rawCall.recording_url,
                        startedAt: rawCall.started_at,
                        payload: {
                            recording_ready_at: new Date().toISOString(),
                        },
                    });
                }
            }
            
            // После того как все звонки сохранены в raw_telphin_calls, проверяем, нет ли среди них наших колбэков
            await processCallbackMatches(rawCalls.map(c => c.telphin_call_id));

            const lastCall = calls[calls.length - 1];
            const lastTimeRaw = lastCall.start_time_gmt || lastCall.init_time_gmt || lastCall.bridged_time_gmt;
            const lastDate = new Date(lastTimeRaw + (lastTimeRaw.includes('Z') ? '' : 'Z'));
            nextCursor = lastDate.toISOString();
        } else {
            nextCursor = now.toISOString();
        }

        await recordTelphinSyncSuccess(nextCursor, options);

        return {
            success: true,
            total_synced: totalSynced,
            new_cursor: nextCursor,
            mode: fetchedCount === options.fetchCount
                ? `${options.modePrefix}_partial`
                : `${options.modePrefix}_caught_up`
        };

    } catch (error: any) {
        console.error(`Telphin Sync Logic Error (${options.source}):`, error);
        await recordTelphinSyncFailure(error.message || `Unknown ${options.source} error`, options);
        return { success: false, error: error.message };
    }
}

export async function runTelphinSync(forceResync: boolean = false, hours: number = 2): Promise<SyncResult> {
    return runTelphinCallHistorySync({
        storageKey: 'telphin_last_sync_time',
        errorKey: 'telphin_fallback_last_error',
        lagKey: 'telphin_fallback_lag_seconds',
        source: 'telphin_fallback_sync',
        defaultLookbackMinutes: getDefaultTelphinFallbackMinutes(),
        fetchCount: 50,
        forceResync,
        hours,
        modePrefix: forceResync ? 'forced_resync' : 'fallback',
    });
}

export async function runTelphinBacklogRecovery(forceResync: boolean = false, hours: number = getTelphinBacklogRecoveryHours()): Promise<SyncResult> {
    return runTelphinCallHistorySync({
        storageKey: 'telphin_backfill_cursor',
        errorKey: 'telphin_backfill_last_error',
        source: 'telphin_backlog_recovery',
        defaultLookbackMinutes: hours * 60,
        fetchCount: 100,
        forceResync,
        hours,
        modePrefix: forceResync ? 'backfill_forced_resync' : 'backfill',
    });
}

async function processCallbackMatches(syncedCallIds: string[]) {
    if (syncedCallIds.length === 0) return;

    // 1. Находим запросы на звонок, которые сейчас в статусе 'calling' и имеют один из синхронизированных ID
    const { data: requests, error: fetchError } = await supabase
        .from('widget_callback_requests')
        .select('*')
        .in('telphin_call_id', syncedCallIds)
        .eq('status', 'calling');

    if (fetchError || !requests || requests.length === 0) return;

    for (const request of requests) {
        // 2. Получаем детали звонка из уже сохраненных сырых данных
        const { data: callData } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .eq('telphin_call_id', request.telphin_call_id)
            .single();

        if (!callData) continue;

        // 3. Определяем успех звонка
        // В Телфине, если duration_sec > 0, значит разговор состоялся (bridged)
        const isSuccess = (callData.duration_sec || 0) > 0;
        const newStatus = isSuccess ? 'completed' : 'failed';

        // 4. Обновляем статус запроса
        await supabase
            .from('widget_callback_requests')
            .update({ status: newStatus })
            .eq('id', request.id);

        // 5. Артем пишет финальное сообщение в чат
        const finalMessage = isSuccess 
            ? '✅ Звонок завершен. Рад, что удалось пообщаться! Если возникнут вопросы — я всегда на связи в этом чате.'
            : '⚠️ К сожалению, не удалось установить соединение (не ответили или занято). Менеджеры попробуют перезвонить вам вручную чуть позже.';

        await supabase.from('widget_messages').insert({
            session_id: request.session_id,
            role: 'system',
            content: finalMessage
        });
        
        console.log(`[Artem:Callback] Match found for ${request.telphin_call_id}. Result: ${newStatus}`);
    }
}
