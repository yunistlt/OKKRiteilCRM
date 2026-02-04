const { createClient } = require('@supabase/supabase-js');

// Hardcoded based on utils/supabase.ts found in the project
const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';

const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnosis() {
    console.log('--- DIAGNOSING TRANSCRIPTION LOGIC (LOCAL) ---');

    try {
        // 1. Check Transcription Status Distribution
        const { count: nullCount } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .is('transcription_status', null);

        const { count: pendingCount } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .eq('transcription_status', 'pending');

        console.log(`Calls with status NULL: ${nullCount}`);
        console.log(`Calls with status 'pending': ${pendingCount}`);

        // 2. Check Status Settings
        const { data: statusSettings, error: settingsError } = await supabase
            .from('status_settings')
            .select('*')
            .eq('is_transcribable', true);

        if (settingsError) console.error(`Error fetching settings: ${settingsError.message}`);

        const transcribableCodes = statusSettings ? statusSettings.map(s => s.code) : [];
        console.log(`Transcribable Status Codes: ${transcribableCodes.join(', ')}`);

        if (transcribableCodes.length === 0) {
            console.log('CRITICAL: No statuses are marked as transcribable!');
        }

        // 3. Try to find ANY candidate match (ignoring status filter first)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: sampleCalls } = await supabase
            .from('raw_telphin_calls')
            .select(`
                telphin_call_id,
                transcription_status,
                started_at,
                recording_url,
                matches:call_order_matches(
                    retailcrm_order_id,
                    orders:orders(status)
                )
            `)
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .order('started_at', { ascending: false })
            .limit(5);

        console.log('\n--- Sample Recent Calls with Recordings ---');

        if (!sampleCalls || sampleCalls.length === 0) {
            console.log('No recent calls found with recording_url (last 30 days).');
        }

        sampleCalls && sampleCalls.forEach(c => {
            const matches = Array.isArray(c.matches) ? c.matches : (c.matches ? [c.matches] : []);

            const statuses = matches.map(m => {
                const ord = Array.isArray(m.orders) ? m.orders[0] : m.orders;
                return ord ? ord.status : 'unknown';
            });

            // Logic check
            const isPending = c.transcription_status === 'pending';
            const hasStatus = statuses.some(s => transcribableCodes.includes(s));

            console.log(`Call ${c.telphin_call_id} (${c.started_at}):`);
            console.log(`   - Status in DB: '${c.transcription_status}'`);
            console.log(`   - Linked Order Statuses: [${statuses.join(', ')}]`);
            console.log(`   - Should pick up? ${isPending && hasStatus ? 'YES' : 'NO'}`);
            if (!isPending) console.log(`     -> Reason: status is not 'pending'`);
            if (!hasStatus) console.log(`     -> Reason: status not in transcribable list`);
        });

    } catch (e) {
        console.error('Fatal Error:', e);
    }
}

runDiagnosis();
