
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

        // 2. Create Synthetic Data (Smart adaptation to Rule SQL)
        console.log(`[RuleTest] Creating synthetic data...`);
        const sql = rule.condition_sql || '';
        const now = new Date();

        let eventTime = now;
        let eventType = 'status_changed';
        let fieldName = 'status';
        let newValue = 'novyi-1';

        // CRITICAL: Use manager from rule parameters if specified
        let managerId = 249; // Default fallback
        if (rule.parameters?.manager_ids && Array.isArray(rule.parameters.manager_ids) && rule.parameters.manager_ids.length > 0) {
            managerId = rule.parameters.manager_ids[0]; // Use first allowed manager
            console.log(`[RuleTest] Using rule-specific manager: ${managerId}`);
        }

        // A. Detection Logic
        // 1. Time based (e.g. > 24 hours)
        if (sql.includes('> 24') || sql.includes('> 48') || sql.includes('NOW()')) {
            // fast forward: make event happen 25h ago
            eventTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);
            console.log('[RuleTest] Detected time condition, backdating event to:', eventTime.toISOString());
        }

        // 2. Event Type (Rescheduling)
        if (sql.includes('next_contact_date') || sql.includes('data_kontakta')) {
            eventType = 'data_kontakta';
            fieldName = 'data_kontakta';
            // Set newValue to a future date for "Rescheduling" logic
            const future = new Date();
            future.setDate(future.getDate() + 5);
            newValue = future.toISOString().split('T')[0];
        }

        // 3. Status Value
        // Try to find required status in SQL: new_value = 'X'
        const statusMatch = sql.match(/new_value\s*=\s*'([^']+)'/);
        if (statusMatch) {
            newValue = statusMatch[1];
            // Also need to set order current_status to this?
        }

        // Create Order
        const { error: orderErr } = await supabase.from('orders').upsert({
            id: testOrderId,
            order_id: testOrderId,
            status: fieldName === 'status' ? newValue : 'work',
            manager_id: managerId
        });
        if (orderErr) throw new Error(`Order creation failed: ${orderErr.message}`);

        // Create Metrics 
        const { error: metricErr } = await supabase.from('order_metrics').upsert({
            retailcrm_order_id: testOrderId,
            manager_id: managerId,
            current_status: fieldName === 'status' ? newValue : 'work',
            full_order_context: {
                manager_comment: '', // Empty comment to trigger "No Comment" rule if applicable
                // For TOP-3 rule, we specifically leave custom fields EMPTY to trigger violation
                status_name: fieldName === 'status' ? newValue : 'work' // Helps with label matching
            }
        });
        if (metricErr) throw new Error(`Metrics creation failed: ${metricErr.message}`);

        // Create Event
        const { error: eventErr } = await supabase.from('raw_order_events').upsert({
            event_id: testEventId,
            retailcrm_order_id: testOrderId,
            event_type: eventType,
            occurred_at: eventTime.toISOString(),
            raw_payload: {
                field: fieldName,
                newValue: newValue,
                oldValue: 'prev_value', // often needed for "change" logic
                status: { code: newValue, name: newValue }, // mocked object structure
                _sync_metadata: {
                    order_statusUpdatedAt: eventTime.toISOString()
                }
            },
            manager_id: managerId
        });
        if (eventErr) throw new Error(`Event creation failed: ${eventErr.message}`);

        // 3. Run Rule Engine
        console.log(`[RuleTest] Executing Rule Engine...`);
        // Ensure window covers the potentially backdated event
        const startTime = new Date(eventTime.getTime() - 2 * 60 * 60 * 1000); // Event time - 2h
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
