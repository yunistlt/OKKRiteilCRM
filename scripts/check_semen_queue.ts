import { supabase } from './utils/supabase';

async function checkQueueDetail() {
    console.log('--- SEMEN LOAD (Last 24h) ---');
    const { data: allCalls } = await supabase.from('raw_telphin_calls')
        .select('transcription_status, transcript')
        .gte('started_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const stats = {
        pending: allCalls?.filter(c => c.transcription_status === 'pending').length || 0,
        processing: allCalls?.filter(c => c.transcription_status === 'processing').length || 0,
        completed: allCalls?.filter(c => c.transcript).length || 0,
        failed: allCalls?.filter(c => c.transcription_status === 'error').length || 0
    };
    console.log(JSON.stringify(stats, null, 2));

    console.log('\n--- DETAILED PENDING QUEUE (Top 20) ---');
    const { data: calls } = await supabase.from('raw_telphin_calls')
        .select('telphin_call_id, started_at, duration_sec, recording_url, transcription_status')
        .eq('transcription_status', 'pending')
        .order('started_at', { ascending: false })
        .limit(20);

    if (!calls || calls.length === 0) {
        console.log('No pending calls found.');
        return;
    }

    const { data: matches } = await supabase.from('call_order_matches')
        .select('telphin_call_id, retailcrm_order_id')
        .in('telphin_call_id', calls.map(c => c.telphin_call_id));

    const matchMap: Record<string, number[]> = {};
    matches?.forEach(m => {
        if (!matchMap[m.telphin_call_id]) matchMap[m.telphin_call_id] = [];
        matchMap[m.telphin_call_id].push(m.retailcrm_order_id);
    });

    for (const c of calls) {
        const orderIds = matchMap[c.telphin_call_id] || [];
        console.log(`Call: ${c.telphin_call_id} | Time: ${c.started_at} | Dur: ${c.duration_sec}s | Rec: ${c.recording_url ? 'YES' : 'NO'} | Matches: ${orderIds.length} (${orderIds.join(',')})`);
    }
}

checkQueueDetail().catch(console.error);
