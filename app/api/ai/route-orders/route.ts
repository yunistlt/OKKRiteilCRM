
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { analyzeOrderForRouting, RoutingOptions, RoutingResult } from '@/lib/ai-router';
import { transcribeCall, isTranscribable } from '@/lib/transcribe';

export const maxDuration = 300; // 5 minutes for batch processing
export const dynamic = 'force-dynamic';

/**
 * Gathers additional context for "Triple Check" (Calls + Emails)
 */
async function getAuditContext(orderId: number) {
    let latestCallTranscript: string | undefined = undefined;
    let latestEmailText: string | undefined = undefined;

    try {
        // 1. Fetch Latest Successful Call
        const { data: matchedCalls, error: matchedError } = await supabase
            .from('call_order_matches')
            .select(`
                telphin_call_id,
                raw_telphin_calls (
                    event_id,
                    transcript,
                    recording_url,
                    duration_sec,
                    started_at,
                    direction
                )
            `)
            .eq('retailcrm_order_id', orderId)
            // Note: ordering by related table field can be tricky in some PostgREST versions, 
            // but we can sort locally or try the syntax:
            // .order('raw_telphin_calls.started_at', { ascending: false }) 
            .limit(5);

        if (!matchedError && matchedCalls && matchedCalls.length > 0) {
            // Sort by started_at descending locally to be safe
            const calls = matchedCalls
                .map((m: any) => m.raw_telphin_calls)
                .filter(Boolean)
                .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

            const latestCall = calls[0];
            if (latestCall) {
                if (latestCall.transcript) {
                    latestCallTranscript = latestCall.transcript;
                } else if (isTranscribable(latestCall)) {
                    console.log(`[Audit] Triggering on-the-fly transcription for call ${latestCall.event_id} (Order ${orderId})`);
                    try {
                        latestCallTranscript = await transcribeCall(latestCall.event_id, latestCall.recording_url);
                    } catch (err) {
                        console.warn(`[Audit] Transcription failed for ${latestCall.event_id}:`, err);
                    }
                }
            }
        }

        // 2. Fetch Latest Communications (Emails/Messages) from History
        // We look for 'customer_comment' or fields that often contain inbound text
        const { data: comms } = await supabase
            .from('raw_order_events')
            .select('event_type, raw_payload')
            .eq('retailcrm_order_id', orderId)
            .or('event_type.ilike.%comment%,event_type.ilike.%message%,event_type.ilike.%email%')
            .order('occurred_at', { ascending: false })
            .limit(3);

        if (comms && comms.length > 0) {
            // Pick most informative inbound one
            const inboundComm = comms.find((c: any) =>
                String(c.raw_payload?.source).toLowerCase() === 'user' ||
                String(c.event_type).includes('customer')
            );
            if (inboundComm) {
                const payload = inboundComm.raw_payload;
                latestEmailText = payload?.newValue || payload?.text || payload?.value || JSON.stringify(payload);
            }
        }

    } catch (auditErr) {
        console.error(`[Audit] Context gathering failed for order ${orderId}:`, auditErr);
    }

    return { latestCallTranscript, latestEmailText };
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const options: RoutingOptions = {
            dryRun: body.dryRun !== false, // Default to dry run for safety
            limit: body.limit || 50, // Process max 50 at a time
            minConfidence: body.minConfidence || 0.7
        };

        console.log('[AIRouter] Starting with options:', options);

        // 0a. Get ALL active statuses for name mapping (display purposes)
        const { data: allStatuses } = await supabase
            .from('statuses')
            .select('code, name')
            .eq('is_active', true);

        const statusMap = new Map(
            allStatuses?.map(s => [s.code, s.name]) || []
        );

        // 0b. Get allowed statuses for AI routing from status_settings
        const { data: routeSettings, error: routeError } = await supabase
            .from('status_settings')
            .select('code, is_ai_target')
            .eq('is_ai_target', true);

        if (routeError) {
            console.error('[AIRouter] Error fetching routing settings:', routeError);
        }

        const allowedCodes = (routeSettings || []).map(s => s.code);

        const { data: allowedStatuses } = await supabase
            .from('statuses')
            .select('code, name, group_name')
            .in('code', allowedCodes)
            .eq('is_active', true);

        const allowedStatusMap = new Map(
            allowedStatuses?.map(s => [s.code, s.name]) || []
        );

        console.log(`[AIRouter] Loaded ${statusMap.size} total statuses, ${allowedStatusMap.size} allowed for AI routing (from status_settings)`);

        // 1. Fetch orders in "Согласование отмены" status
        const { data: orders, error: fetchError } = await supabase
            .from('orders')
            .select('id, status, totalsumm')
            .eq('status', 'soglasovanie-otmeny')
            .limit(options.limit!);

        if (fetchError) throw new Error(`Failed to fetch orders: ${fetchError.message}`);
        if (!orders || orders.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No orders to process',
                results: []
            });
        }

        console.log(`[AIRouter] Processing ${orders.length} orders...`);

        const retailCrmBaseUrl = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;

        // 2. Process each order
        const results: RoutingResult[] = [];

        for (const order of orders) {
            try {
                // ... (existing processing code) ...
                // Note: I am NOT replacing the loop logic, just the SELECT and the PUSH.
                // Wait, use replace_file_content carefully.
                // I will use multi_replace to target specific blocks.

                // 2a. Fetch fresh data from RetailCRM
                // Try by ID first, then fallback to Number if not found
                const baseUrl = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL)?.replace(/\/$/, '');
                const apiKey = (process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY)?.trim();

                if (!baseUrl || !apiKey) {
                    throw new Error(`RetailCRM configuration missing (URL: ${!!baseUrl}, Key: ${!!apiKey})`);
                }

                let fetchResponse = await fetch(
                    `${baseUrl}/api/v5/orders?apiKey=${apiKey}&filter[ids][]=${order.id}&limit=20`
                );
                let fetchData = await fetchResponse.json();

                if (!fetchData.success || !fetchData.orders || fetchData.orders.length === 0) {
                    console.log(`[AIRouter] Order ${order.id} not found by ID, trying by Number...`);
                    fetchResponse = await fetch(
                        `${baseUrl}/api/v5/orders?apiKey=${apiKey}&filter[numbers][]=${order.id}&limit=20`
                    );
                    fetchData = await fetchResponse.json();
                }

                if (!fetchData.success || !fetchData.orders || fetchData.orders.length === 0) {
                    throw new Error(`Order ${order.id} not found in RetailCRM (Tried IDs and Numbers). Response: ${JSON.stringify(fetchData)}`);
                }

                // Ensure we use the same key for the update part later
                (order as any)._apiKey = apiKey;
                (order as any)._baseUrl = baseUrl;

                const retailcrmOrder = fetchData.orders[0];
                const orderSite = retailcrmOrder.site;
                const comment = retailcrmOrder.managerComment || '';

                // 2b. Gather Triple Check Audit Context
                const auditContext = await getAuditContext(Number(order.id));

                // Prepare system context for AI to handle chronology correctly
                const systemContext = {
                    currentTime: new Date().toISOString(),
                    orderUpdatedAt: retailcrmOrder.statusUpdatedAt || retailcrmOrder.updatedAt || new Date().toISOString()
                };

                // 2c. Analyze with AI (pass allowed statuses for routing + contexts)
                const decision = await analyzeOrderForRouting(comment, allowedStatusMap, systemContext, auditContext);

                console.log(`[AIRouter] Order ${order.id} Audit Context:`, {
                    hasTranscript: !!auditContext.latestCallTranscript,
                    hasEmail: !!auditContext.latestEmailText
                });

                // Log to database
                const { error: logError } = await supabase
                    .from('ai_routing_logs')
                    .insert({
                        order_id: order.id,
                        from_status: order.status,
                        to_status: decision.target_status,
                        manager_comment: comment,
                        ai_reasoning: decision.reasoning,
                        confidence: decision.confidence,
                        was_applied: false // Will update if we actually apply
                    });

                if (logError) {
                    console.error(`[AIRouter] Log error for order ${order.id}:`, logError);
                }

                // 2c. Apply status change if not dry run
                let wasApplied = false;
                let error: string | undefined;

                if (!options.dryRun && decision.confidence >= options.minConfidence!) {
                    try {
                        // Append new comment, ensuring there's a separator if existing comment is not empty
                        const newComment = comment
                            ? `${comment}\n\nОКК: ${decision.reasoning}`
                            : `ОКК: ${decision.reasoning}`;

                        console.log(`[AIRouter] Order ${order.id} is on site: ${orderSite}. Existing comment length: ${comment.length}`);

                        const currentBaseUrl = (order as any)._baseUrl;
                        const currentApiKey = (order as any)._apiKey;

                        // Update status in RetailCRM
                        const requestBody = {
                            status: decision.target_status,
                            managerComment: newComment,
                            // Clear next_contact_date to avoid validation errors
                            customFields: {
                                next_contact_date: null
                            }
                        };

                        console.log(`[AIRouter] Updating order ${order.id} in RetailCRM:`, requestBody);

                        const url = `${currentBaseUrl}/api/v5/orders/${order.id}/edit?by=id`;
                        const retailcrmResponse = await fetch(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: new URLSearchParams({
                                apiKey: currentApiKey,
                                site: orderSite,
                                order: JSON.stringify(requestBody)
                            })
                        });

                        const retailcrmUpdateData = await retailcrmResponse.json();
                        console.log(`[AIRouter] RetailCRM response for order ${order.id}:`, retailcrmUpdateData);

                        if (!retailcrmUpdateData.success) {
                            throw new Error(JSON.stringify(retailcrmUpdateData));
                        }

                        // Also update in our local database
                        await supabase
                            .from('orders')
                            .update({ status: decision.target_status })
                            .eq('id', order.id);

                        wasApplied = true;

                        // Update log to mark as applied
                        await supabase
                            .from('ai_routing_logs')
                            .update({
                                was_applied: true,
                                applied_at: new Date().toISOString()
                            })
                            .eq('order_id', order.id)
                            .order('created_at', { ascending: false })
                            .limit(1);

                        console.log(`[AIRouter] Successfully updated order ${order.id} to ${decision.target_status}`);

                    } catch (apiError: any) {
                        error = apiError.message;
                        console.error(`[AIRouter] RetailCRM API error for order ${order.id}:`, apiError);
                    }
                }

                results.push({
                    order_id: order.id,
                    from_status: order.status,
                    current_status_name: statusMap.get(order.status) || order.status,
                    total_sum: order.totalsumm || 0,
                    retail_crm_url: retailCrmBaseUrl,
                    to_status: decision.target_status,
                    to_status_name: statusMap.get(decision.target_status) || decision.target_status,
                    confidence: decision.confidence,
                    reasoning: decision.reasoning,
                    was_applied: wasApplied,
                    error
                });

            } catch (orderError: any) {
                console.error(`[AIRouter] Error processing order ${order.id}:`, orderError);
                const errorMsg = `[v2.1] Processing error: ${orderError.message}`;

                // Log error to database as well
                try {
                    await supabase
                        .from('ai_routing_logs')
                        .insert({
                            order_id: order.id,
                            from_status: order.status,
                            to_status: 'otmenen-propala-neobkhodimost',
                            manager_comment: 'ERROR FETCHING DATA',
                            ai_reasoning: errorMsg,
                            confidence: 0,
                            was_applied: false
                        });
                } catch (dbErr) {
                    console.error('[AIRouter] Failed to log error to DB:', dbErr);
                }

                results.push({
                    order_id: order.id,
                    from_status: order.status,
                    to_status: 'otmenen-propala-neobkhodimost',
                    to_status_name: statusMap.get('otmenen-propala-neobkhodimost') || 'Пропала необходимость',
                    confidence: 0,
                    reasoning: errorMsg,
                    was_applied: false,
                    error: orderError.message
                });
            }
        }

        // 3. Generate summary
        const summary = {
            total_processed: results.length,
            applied: results.filter(r => r.was_applied).length,
            dry_run: options.dryRun,
            status_distribution: results.reduce((acc, r) => {
                acc[r.to_status] = (acc[r.to_status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        };

        return NextResponse.json({
            success: true,
            summary,
            results
        });

    } catch (e: any) {
        console.error('[AIRouter] Error:', e);
        return NextResponse.json({
            success: false,
            error: e.message
        }, { status: 500 });
    }
}
