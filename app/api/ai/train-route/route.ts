
// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { editOrder } from '@/lib/own-crm/edit-order';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for safe RetailCRM updates

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { orderId, targetStatus, reasoning, orderContext } = body;

        if (!orderId || !targetStatus || !reasoning) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        console.log(`[TrainRoute] Processing order ${orderId} -> ${targetStatus}`);

        /**
         * Статус пишем одной дверью — `editOrder` (закон проекта): он
         * обновляет нашу базу и кладёт историю, от которой зависят зарплата и
         * ОКК. До 15.10.2026 правка уходила в RetailCRM, и по заказам нашей
         * базы обучение просто падало («Order not found in RetailCRM»).
         */
        const { data: orderRow } = await supabase
            .from('orders')
            .select('id, number, raw_payload')
            .or(`order_id.eq.${orderId},number.eq.${orderId}`)
            .maybeSingle();

        if (!orderRow) {
            throw new Error(`Заказ ${orderId} не найден`);
        }

        const internalId = Number((orderRow as any).id);
        const existingComment = String((orderRow as any).raw_payload?.managerComment || '');
        const newFullComment = existingComment
            ? `${existingComment}\n\nОКК: ${reasoning}`
            : `ОКК: ${reasoning}`;

        const applied = await editOrder(internalId, {
            statusCode: targetStatus,
            managerComment: newFullComment,
        });

        if (!applied.ok) {
            throw new Error(`Статус не записался: ${applied.reason}`);
        }

        // 5. Save Training Example
        // We use 'green' as dummy traffic_light, and store real target_status in context
        const trainingContext = {
            ...orderContext,
            target_status: targetStatus, // Crucial for routing training
            routing_training: true
        };

        let embedding: number[] | null = null;
        try {
            const { generateEmbedding, formatExampleForEmbedding } = await import('@/lib/embeddings');
            const textToEmbed = formatExampleForEmbedding(reasoning, trainingContext);
            embedding = await generateEmbedding(textToEmbed);
        } catch (embErr) {
            console.warn('[TrainRoute] Embedding generation failed:', embErr);
        }

        const trainingData = {
            order_id: internalId,
            order_number: (orderRow as any).number,
            traffic_light: 'green', // Default/Dummy
            user_reasoning: reasoning,
            order_context: trainingContext,
            embedding: embedding,
            created_by: 'manual_training_interface'
        };

        const { error: trainError } = await supabase
            .from('training_examples')
            .insert(trainingData);

        if (trainError) {
            console.error('[TrainRoute] Failed to save training example:', trainError);
            // Don't fail the whole request, as the operation succeeded
        }

        return NextResponse.json({ success: true, orderId: internalId, status: targetStatus });

    } catch (e: any) {
        console.error('[TrainRoute] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
