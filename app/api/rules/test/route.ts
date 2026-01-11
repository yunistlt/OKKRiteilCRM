
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { runRuleEngine } from '@/lib/rule-engine';

export const maxDuration = 60; // Allow enough time for synthetic test
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    let testOrderId = 999000 + Math.floor(Math.random() * 999);
    let testEventId = 888000 + Math.floor(Math.random() * 999);
    let ruleId: string;

    try {
        const body = await request.json();
        console.log('[RuleTest] Received body:', JSON.stringify(body));
        ruleId = body.ruleId;

        if (!ruleId) {
            console.error('[RuleTest] Missing ruleId in body:', body);
            return NextResponse.json({ success: false, error: 'Missing ruleId' }, { status: 400 });
        }

        console.log(`[RuleTest] Starting test for rule: ${ruleId}`);

        // 1. Fetch Rule Info
        const { data: rule, error: ruleError } = await supabase
            .from('okk_rules')
            .select('*')
            .eq('code', ruleId)
            .single();

        if (ruleError || !rule) {
            throw new Error(`Rule ${ruleId} not found`);
        }

        // 2. Create Synthetic Data (Always creates a VIOLATION)
        console.log(`[RuleTest] Creating synthetic data...`);

        // Create Order
        const { error: orderErr } = await supabase.from('orders').upsert({
            id: testOrderId,
            order_id: testOrderId,
            status: 'novyi-1',
            manager_id: 249 // Standard test manager
        });
        if (orderErr) throw new Error(`Order creation failed: ${orderErr.message}`);

        // Create Metrics (Empty comment for violations)
        const { error: metricErr } = await supabase.from('order_metrics').upsert({
            retailcrm_order_id: testOrderId,
            manager_id: 249,
            current_status: 'novyi-1',
            full_order_context: { manager_comment: '' }
        });
        if (metricErr) throw new Error(`Metrics creation failed: ${metricErr.message}`);

        // Create Event
        const now = new Date();
        const { error: eventErr } = await supabase.from('raw_order_events').upsert({
            event_id: testEventId,
            retailcrm_order_id: testOrderId,
            event_type: 'status_changed',
            occurred_at: now.toISOString(),
            raw_payload: {
                field: 'status',
                newValue: 'novyi-1',
                _sync_metadata: {
                    order_statusUpdatedAt: now.toISOString()
                }
            },
            manager_id: 249
        });
        if (eventErr) throw new Error(`Event creation failed: ${eventErr.message}`);

        // 3. Run Rule Engine
        console.log(`[RuleTest] Executing Rule Engine...`);
        const startTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 min window
        const endTime = new Date(now.getTime() + 60 * 1000);

        const violationsFound = await runRuleEngine(
            startTime.toISOString(),
            endTime.toISOString(),
            ruleId
        );

        // 4. Verify Violation Exists
        const { data: dbViolations } = await supabase
            .from('okk_violations')
            .select('*')
            .eq('rule_code', ruleId)
            .eq('order_id', testOrderId);

        const isSuccess = (violationsFound || 0) > 0 && dbViolations && dbViolations.length > 0;
        const resultMessage = isSuccess
            ? 'Проверка пройдена: Нарушение обнаружено.'
            : 'Проверка не пройдена: Нарушение не зафиксировано.';

        // 5. Log Result
        await supabase.from('okk_rule_test_logs').insert({
            rule_code: ruleId,
            status: isSuccess ? 'success' : 'failure',
            message: resultMessage,
            details: {
                test_order_id: testOrderId,
                test_event_id: testEventId,
                violations_found_count: violationsFound || 0,
                db_violations_count: dbViolations?.length || 0,
                range: { start: startTime.toISOString(), end: endTime.toISOString() }
            }
        });

        // 6. Cleanup
        console.log(`[RuleTest] Cleaning up synthetic data...`);
        await supabase.from('okk_violations').delete().eq('order_id', testOrderId);
        await supabase.from('raw_order_events').delete().eq('event_id', testEventId);
        await supabase.from('order_metrics').delete().eq('retailcrm_order_id', testOrderId);
        await supabase.from('orders').delete().eq('id', testOrderId);

        return NextResponse.json({
            success: isSuccess,
            message: resultMessage,
            violationsCount: violationsFound
        });

    } catch (e: any) {
        console.error(`[RuleTest] Error:`, e.message);

        // Log error if possible
        if (ruleId!) {
            const { error: logErr } = await supabase.from('okk_rule_test_logs').insert({
                rule_code: ruleId,
                status: 'error',
                message: `Ошибка выполнения теста: ${e.message}`,
                details: { error: e.message, test_order_id: testOrderId }
            });
            if (logErr) console.error('Failed to log test error:', logErr);
        }

        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
