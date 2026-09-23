// Общий шаг «после готовности транскрипта»: найти заказ звонка и поставить downstream-джобы
// (семантические правила → пересчёт скора → инсайт ОКК). Используется и синхронным путём
// (воркер транскрибации), и async-поллером — поэтому вынесено сюда.
import { supabase } from '@/utils/supabase';
import { enqueueCallSemanticRulesJob, enqueueOrderRefreshJob } from '@/lib/system-jobs';
import { orderOfCall } from '@/lib/calls-of-order';

export async function enqueueTranscriptionDownstream(
    callId: string,
    source: string,
    parentJobId?: number,
): Promise<{ orderId: string | null; jobs: string[] }> {
    try {
        // Заказ звонка: сначала спрашиваем RetailCRM — там привязку сделали
        // в карточке, а не угадали по номеру телефона. Наш матчинг остаётся
        // запасным и ошибается примерно в трети случаев.
        const found = await orderOfCall(callId);
        if (!found) return { orderId: null, jobs: [] };

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
