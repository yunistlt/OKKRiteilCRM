/**
 * Разбор строки истории звонков Телфина в нашу запись `raw_telphin_calls`.
 *
 * Вынесено из `lib/sync/telphin.ts` без изменений 05.10.2026, чтобы историческая
 * дотяжка (`scripts/backfill-telphin-history.ts`) складывала звонки ровно так
 * же, как обычная синхронизация, а не своим вторым разбором.
 */

/** Номер в сравнимом виде: только цифры, без ведущих 7/8. */
export function normalizeTelphinPhone(val: any): string | null {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

export type RawTelphinCall = {
    telphin_call_id: string;
    record_uuids: string[] | null;
    direction: string;
    from_number: string;
    to_number: string;
    from_number_normalized: string | null;
    to_number_normalized: string | null;
    started_at: string;
    duration_sec: number;
    recording_url: string | null;
    raw_payload: any;
    ingested_at: string;
};

export function telphinCallToRaw(r: any): RawTelphinCall {
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

    // «Вторая наклейка»: все record_uuid плеч звонка в формате RetailCRM externalId
    // ("<extId>-<record_uuid>", нижний регистр) — для прямой стыковки с retailcrm_calls.
    const recordUuids = Array.isArray(r.cdr)
        ? Array.from(new Set(
            r.cdr
                .map((c: any) => c.record_uuid)
                .filter(Boolean)
                .map((u: any) => String(u).toLowerCase()),
        )) as string[]
        : [];

    return {
        telphin_call_id: record_uuid,
        record_uuids: recordUuids.length ? recordUuids : null,
        direction,
        from_number: fromNumber || 'unknown',
        to_number: toNumber || 'unknown',
        from_number_normalized: normalizeTelphinPhone(fromNumber),
        to_number_normalized: normalizeTelphinPhone(toNumber),
        started_at: callDate.toISOString(),
        duration_sec: r.duration || 0,
        recording_url: recordingUrl,
        raw_payload: r,
        ingested_at: new Date().toISOString(),
    };
}

/** Дата для Телфина: «ГГГГ-ММ-ДД ЧЧ:ММ:СС» по Гринвичу. */
export function formatTelphinDate(date: Date): string {
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
