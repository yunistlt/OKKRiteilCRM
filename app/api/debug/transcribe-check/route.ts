import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    try {
        log('--- DIAGNOSING TRANSCRIPTION LOGIC ---');

        // 1. Check Transcription Status Distribution
        const { count: nullCount } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .is('transcription_status', null);

        const { count: pendingCount } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .eq('transcription_status', 'pending');

        log(`Calls with status NULL: ${nullCount}`);
        log(`Calls with status 'pending': ${pendingCount}`);

        // 2. Check Status Settings
        const { data: statusSettings, error: settingsError } = await supabase
            .from('status_settings')
            .select('*')
            .eq('is_transcribable', true);

        if (settingsError) log(`Error fetching settings: ${settingsError.message}`);

        const transcribableCodes = statusSettings?.map(s => s.code) || [];
        log(`Transcribable Status Codes: ${transcribableCodes.join(', ')}`);

        if (transcribableCodes.length === 0) {
            log('CRITICAL: No statuses are marked as transcribable!');
        }

        // 3. Try to find ANY candidate match (ignoring status filter first)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: sampleCalls } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                transcription_status,
                matches:call_order_matches(
                    retailcrm_order_id,
                    orders:orders(status)
                )
            `)
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .order('started_at', { ascending: false })
            .limit(10);

        log('\n--- Sample Recent Calls with Recordings ---');
        sampleCalls?.forEach(c => {
            // Safe access to nested arrays/objects which might be arrays or objects depending on DB relationship
            const matches: any[] = Array.isArray(c.matches) ? c.matches : (c.matches ? [c.matches] : []);

            const statuses = matches.map((m: any) => {
                // Handle nested orders which could be single object or array
                const ord = Array.isArray(m.orders) ? m.orders[0] : m.orders;
                return ord?.status || 'unknown';
            });

            const isPending = c.transcription_status === 'pending';
            const hitsConfig = statuses.some((s: string) => transcribableCodes.includes(s));

            log(`Call ${c.telphin_call_id}: Status='${c.transcription_status}', OrderStatuses=[${statuses.join(', ')}] -> Should process? ${isPending && hitsConfig ? 'YES' : 'NO'}`);
        });

        return NextResponse.json({ logs });

    } catch (e: any) {
        return NextResponse.json({ error: e.message, logs }, { status: 500 });
    }
}
