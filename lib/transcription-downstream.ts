// Общий шаг «после готовности транскрипта»: найти заказ звонка и поставить downstream-джобы
// (семантические правила → пересчёт скора → инсайт ОКК). Используется и синхронным путём
// (воркер транскрибации), и async-поллером — поэтому вынесено сюда.
import { supabase } from '@/utils/supabase';
import { enqueueCallSemanticRulesJob, enqueueOrderRefreshJob } from '@/lib/system-jobs';
import { orderOfCall } from '@/lib/calls-of-order';
import { suggestOrderFromTranscript } from '@/lib/call-binding';

export async function enqueueTranscriptionDownstream(
    callId: string,
    source: string,
    parentJobId?: number,
): Promise<{ orderId: string | null; jobs: string[] }> {
    try {
        // Заказ звонка берём из привязки, сделанной в ОКК или RetailCRM.
        const found = await orderOfCall(callId);
        if (!found) {
            /**
             * Привязки нет — пробуем подсказать заказ по самому разговору:
             * номер в нём почти всегда звучит вслух (третий способ из решения
             * владельца 05.10.2026). Это подсказка, а не привязка: разборы по
             * ней не запускаем, менеджер подтверждает её в разделе «Звонки».
             */
            const { data: call } = await supabase
                .from('raw_telphin_calls')
                .select('transcript')
                .eq('telphin_call_id', callId)
                .maybeSingle();

            const transcript = (call as any)?.transcript;
            if (transcript) await suggestOrderFromTranscript(callId, String(transcript));

            return { orderId: null, jobs: [] };
        }

        const orderId = String(found.orderId);
        const transcriptCompletedAt = new Date().toISOString();

        await enqueueCallSemanticRulesJob({
            callId,
            source,
            payload: { retailcrm_order_id: orderId, transcript_completed_at: transcriptCompletedAt },
            priority: 20,
            parentJobId,
        });
        await enqueueOrderRefreshJob({
            jobType: 'order_score_refresh',
            orderId,
            source,
            payload: { telphin_call_id: callId, transcript_completed_at: transcriptCompletedAt },
            priority: 25,
        });
        await enqueueOrderRefreshJob({
            jobType: 'order_insight_refresh',
            orderId,
            source,
            payload: { telphin_call_id: callId, transcript_completed_at: transcriptCompletedAt },
            priority: 35,
            parentJobId,
        });

        return { orderId, jobs: ['call_semantic_rules', 'order_score_refresh', 'order_insight_refresh'] };
    } catch (e: any) {
        console.error(`[TranscriptionDownstream] failed for ${callId}, ignoring:`, e?.message);
        return { orderId: null, jobs: [] };
    }
}
