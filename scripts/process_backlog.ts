import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabase } from '../utils/supabase';
import { analyzeOrderForRouting } from '../lib/ai-router';

const DRY_RUN = process.argv.includes('--apply') === false;
const LIMIT = 600;
const BATCH_SIZE = 10;

async function processBacklog() {
    console.log(`🚀 Starting backlog processing (${DRY_RUN ? 'DRY RUN' : 'PRODUCTION APPLY'})...`);

    // 1. Fetch statuses for name mapping
    const { data: statusData } = await supabase.from('statuses').select('code, name');
    const statusMap = new Map(statusData?.map(s => [s.code, s.name]) || []);

    // We only route to "Working" statuses or "Cancel" statuses
    // For simplicity, we'll fetch all active statuses
    const allowedStatusMap = new Map(statusData?.map(s => [s.code, s.name]) || []);

    // 2. Fetch orders
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, status, site')
        .eq('status', 'soglasovanie-otmeny')
        .limit(LIMIT);

    if (error) {
        console.error('❌ DB Error fetching orders:', error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log('✅ No orders to process.');
        return;
    }

    console.log(`📦 Found ${orders.length} orders to process.`);

    let processedCount = 0;
    let appliedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        console.log(`\n--- Processing Batch ${i / BATCH_SIZE + 1} (${batch.length} orders) ---`);

        await Promise.all(batch.map(async (order) => {
            try {
                // Fetch fresh from RetailCRM using site for reliability
                const params = new URLSearchParams({
                    apiKey: process.env.RETAILCRM_API_KEY!,
                    'filter[ids][0]': String(order.id)
                });
                if (order.site) params.append('site', order.site);

                const fetchRes = await fetch(
                    `${process.env.RETAILCRM_URL}/api/v5/orders?${params.toString()}`
                );
                const fetchData = await fetchRes.json();

                if (!fetchData.success || !fetchData.orders || fetchData.orders.length === 0) {
                    throw new Error(`Order ${order.id} (site: ${order.site}) not found in CRM`);
                }

                const retailcrmOrder = fetchData.orders[0];
                const orderSite = retailcrmOrder.site; // Use the actual site returned
                const comment = retailcrmOrder.managerComment || '';
                const systemContext = {
                    currentTime: new Date().toISOString(),
                    orderUpdatedAt: retailcrmOrder.statusUpdatedAt || retailcrmOrder.updatedAt || new Date().toISOString()
                };

                // Analyze
                const decision = await analyzeOrderForRouting(comment, allowedStatusMap, systemContext);

                console.log(`[Order ${order.id}] AI: ${decision.target_status} (${Math.round(decision.confidence * 100)}%) - ${decision.reasoning.slice(0, 100)}...`);

                // Log result to DB
                await supabase
                    .from('ai_routing_logs')
                    .insert({
                        order_id: order.id,
                        from_status: order.status,
                        to_status: decision.target_status,
                        manager_comment: comment,
                        ai_reasoning: decision.reasoning,
                        confidence: decision.confidence,
                        was_applied: false
                    });

                if (!DRY_RUN && decision.confidence >= 0.7) {
                    // Update CRM
                    const newComment = comment
                        ? `${comment}\n\nОКК: ${decision.reasoning}`
                        : `ОКК: ${decision.reasoning}`;

                    const updateBody = {
                        status: decision.target_status,
                        managerComment: newComment,
                        customFields: { next_contact_date: null }
                    };

                    const updateRes = await fetch(
                        `${process.env.RETAILCRM_URL}/api/v5/orders/${order.id}/edit?by=id`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({
                                apiKey: process.env.RETAILCRM_API_KEY!,
                                site: retailcrmOrder.site,
                                order: JSON.stringify(updateBody)
                            })
                        }
                    );

                    const updateData = await updateRes.json();
                    if (updateData.success) {
                        // Update local DB
                        await supabase.from('orders').update({ status: decision.target_status }).eq('id', order.id);

                        // Update log
                        await supabase
                            .from('ai_routing_logs')
                            .update({ was_applied: true, applied_at: new Date().toISOString() })
                            .eq('order_id', order.id)
                            .order('created_at', { ascending: false })
                            .limit(1);

                        appliedCount++;
                    } else {
                        console.error(`[Order ${order.id}] Update failed:`, JSON.stringify(updateData));
                        errorCount++;
                    }
                }

                processedCount++;
            } catch (err: any) {
                console.error(`❌ [Order ${order.id}] Error:`, err.message);
                errorCount++;
            }
        }));

        // Small pause between batches
        if (!DRY_RUN) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n🎉 Processing Complete!`);
    console.log(`Total Processed: ${processedCount}`);
    console.log(`Applied: ${appliedCount}`);
    console.log(`Errors: ${errorCount}`);
    if (DRY_RUN) console.log(`\n💡 This was a DRY RUN. Use --apply to make changes.`);
}

processBacklog();
