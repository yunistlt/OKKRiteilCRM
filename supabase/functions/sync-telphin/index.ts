// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELPHIN_CLIENT_ID = Deno.env.get('TELPHIN_CLIENT_ID')
const TELPHIN_CLIENT_SECRET = Deno.env.get('TELPHIN_CLIENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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

function normalizePhone(val: any) {
    if (!val) return null;
    let s = String(val).replace(/[^\d]/g, '');
    if (s.length === 11 && (s.startsWith('7') || s.startsWith('8'))) {
        s = s.slice(1);
    }
    return s.length >= 10 ? s : null;
}

async function getTelphinToken() {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_CLIENT_ID!);
    params.append('client_secret', TELPHIN_CLIENT_SECRET!);

    const res = await fetch('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Auth Failed: ${txt}`);
    }

    const data = await res.json();
    return data.access_token;
}

Deno.serve(async (req) => {
    try {
        const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
        const token = await getTelphinToken()

        const now = new Date();
        const storageKey = 'telphin_last_sync_time';

        // 1. Get Cursor
        let start = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const { data: state } = await supabase
            .from('sync_state')
            .select('value')
            .eq('key', storageKey)
            .single();

        if (state?.value) {
            const storedDate = new Date(state.value);
            if (storedDate < now) {
                start = storedDate;
            }
        }

        // 2. Get Client ID
        const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const userData = await userRes.json();
        const clientId = userData.client_id;

        // 3. Fetch Calls
        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(start),
            end_datetime: formatTelphinDate(now),
            order: 'asc',
            count: '100'
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const calls = data.call_history || [];

        // 4. Transform & Upsert
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
                    if (cdrWithStorage) recordingUrl = cdrWithStorage.storage_url;
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

            const { error } = await supabase.from('raw_telphin_calls').upsert(rawCalls, { onConflict: 'telphin_call_id' });
            if (error) throw error;

            // Update Cursor
            const lastCall = calls[calls.length - 1];
            const lastTimeRaw = lastCall.start_time_gmt || lastCall.init_time_gmt || lastCall.bridged_time_gmt;
            const lastDate = new Date(lastTimeRaw + (lastTimeRaw.includes('Z') ? '' : 'Z'));

            await supabase.from('sync_state').upsert({
                key: storageKey,
                value: lastDate.toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
        } else {
            await supabase.from('sync_state').upsert({
                key: storageKey,
                value: now.toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
        }

        return new Response(JSON.stringify({ success: true, synced: calls.length }), { headers: { 'Content-Type': 'application/json' } })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
})
