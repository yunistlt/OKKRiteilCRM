import { supabase } from '@/utils/supabase';
import { getTelphinToken } from './telphin';

/**
 * Downloads audio from Telphin and uploads it to Supabase Storage
 * Returns the public URL of the stored file
 */
export async function syncRecordingToStorage(telphinCallId: string, recordingUrl: string): Promise<string | null> {
    try {
        console.log(`[Storage] Starting sync for ${telphinCallId}...`);

        // 1. Check if already synced
        const { data: callData } = await supabase
            .from('raw_telphin_calls')
            .select('raw_payload')
            .eq('telphin_call_id', telphinCallId)
            .single();

        if (callData?.raw_payload?.storage_url) {
            console.log(`[Storage] Already synced: ${callData.raw_payload.storage_url}`);
            return callData.raw_payload.storage_url;
        }

        // 2. Download from Telphin
        const token = await getTelphinToken();
        const res = await fetch(recordingUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            throw new Error(`Telphin download failed: ${res.status}`);
        }

        const buffer = await res.arrayBuffer();
        const fileName = `${telphinCallId}.mp3`;

        // 3. Upload to Supabase
        const { error: uploadError } = await supabase.storage
            .from('call-recordings')
            .upload(fileName, buffer, {
                contentType: 'audio/mpeg',
                upsert: true
            });

        if (uploadError) throw uploadError;

        // 4. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('call-recordings')
            .getPublicUrl(fileName);

        // 5. Update DB (store in raw_payload)
        const updatedPayload = {
            ...(callData?.raw_payload || {}),
            storage_url: publicUrl,
            synced_at: new Date().toISOString()
        };

        await supabase
            .from('raw_telphin_calls')
            .update({ raw_payload: updatedPayload })
            .eq('telphin_call_id', telphinCallId);

        console.log(`[Storage] Sync complete: ${publicUrl}`);
        return publicUrl;
    } catch (e) {
        console.error(`[Storage] Sync failed for ${telphinCallId}:`, e);
        return null;
    }
}
