import { createClient } from '@supabase/supabase-js';

const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';
const supabase = createClient('https://lywtzgntmibdpgoijbty.supabase.co', supabaseKey);

async function check() {
    const orderId = 50839;

    // Exact logic from route.ts
    const { data: callMatches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id')
        .eq('retailcrm_order_id', orderId);

    const callIds = (callMatches || []).map(m => m.telphin_call_id);
    console.log("Call IDs:", callIds);

    if (callIds.length === 0) {
        console.log("No calls found");
        return;
    }

    const { data: callsData, error } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .in('telphin_call_id', callIds)
        .order('started_at', { ascending: false });

    if (error) {
        console.error("Error fetching calls:", error);
    }
    const calls = callsData || [];
    console.log("Raw calls fetched:", calls.length);

    const mappedCalls = calls.map(c => ({
        id: c.telphin_call_id,
        date: c.started_at,
        type: c.direction,
        duration: c.duration_sec,
        transcription: c.transcript || c.call_transcriptions?.[0]?.transcription_text || null,
        summary: c.summary || c.call_transcriptions?.[0]?.summary || null,
        link: c.recording_url
    }));

    mappedCalls.forEach(mc => {
        console.log(`Call ID: ${mc.id} | Transcription length: ${mc.transcription ? mc.transcription.length : 0} | Link: ${mc.link ? 'YES' : 'NO'}`);
    });
}
check();
