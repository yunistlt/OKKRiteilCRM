
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { analyzeOrderForRouting, RoutingOptions, RoutingResult } from '@/lib/ai-router';

export const maxDuration = 300; // 5 minutes for batch processing
export const dynamic = 'force-dynamic';

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

        // 0b. Get allowed statuses for AI routing:
        // - ALL statuses from "Отменен" group (regardless of АНАЛИЗ checkbox)
        // - ONLY statuses with АНАЛИЗ checkbox (is_working = true) from other groups
        const { data: allowedStatuses } = await supabase
            .from('statuses')
            .select('code, name, group_name, is_working')
            .eq('is_active', true)
            .or('group_name.ilike.%отмен%,is_working.eq.true');

        const allowedStatusMap = new Map(
            allowedStatuses?.map(s => [s.code, s.name]) || []
        );

        console.log(`[AIRouter] Loaded ${statusMap.size} total statuses, ${allowedStatusMap.size} allowed for AI routing`);

        // 1. Fetch orders in "Согласование отмены" status
        // Note: order_metrics uses retailcrm_order_id, not orders.id
        const { data: orders, error: fetchError } = await supabase
            .from('orders')
            .select('id, status')
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

        // Fetch metrics separately
        const orderIds = orders.map(o => o.id);
        const { data: metrics } = await supabase
            .from('order_metrics')
            .select('retailcrm_order_id, full_order_context')
            .in('retailcrm_order_id', orderIds);

        // Create a map for quick lookup
        const metricsMap = new Map(
            metrics?.map(m => [m.retailcrm_order_id, m]) || []
        );

        console.log(`[AIRouter] Processing ${orders.length} orders...`);

        // 2. Process each order
        const results: RoutingResult[] = [];

        for (const order of orders) {
            try {
                const orderMetrics = metricsMap.get(order.id);
                const comment = orderMetrics?.full_order_context?.manager_comment || '';

                // Analyze with AI (pass allowed statuses for routing)
                const decision = await analyzeOrderForRouting(comment, allowedStatusMap);

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

                // Apply status change if not dry run
                let wasApplied = false;
                let error: string | undefined;

                if (!options.dryRun && decision.confidence >= options.minConfidence!) {
                    try {
                        // Update status in RetailCRM
                        const retailcrmResponse = await fetch(`${process.env.NEXT_PUBLIC_RETAILCRM_URL}/api/v5/orders/${order.id}/edit`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: new URLSearchParams({
                                apiKey: process.env.RETAILCRM_API_KEY!,
                                order: JSON.stringify({
                                    status: decision.target_status
                                })
                            })
                        });

                        const retailcrmData = await retailcrmResponse.json();

                        if (!retailcrmData.success) {
                            throw new Error(retailcrmData.errorMsg || 'RetailCRM API error');
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
                    to_status: decision.target_status,
                    to_status_name: statusMap.get(decision.target_status) || decision.target_status,
                    confidence: decision.confidence,
                    reasoning: decision.reasoning,
                    was_applied: wasApplied,
                    error
                });

            } catch (orderError: any) {
                console.error(`[AIRouter] Error processing order ${order.id}:`, orderError);
                results.push({
                    order_id: order.id,
                    from_status: order.status,
                    to_status: 'otmenen-propala-neobkhodimost',
                    to_status_name: statusMap.get('otmenen-propala-neobkhodimost') || 'Пропала необходимость',
                    confidence: 0,
                    reasoning: 'Processing error',
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
