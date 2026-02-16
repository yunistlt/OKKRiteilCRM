
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runRuleEngine } from '@/lib/rule-engine';

export const maxDuration = 60; // Allow enough time for synthetic test
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    let testOrderId = 999000 + Math.floor(Math.random() * 999);
    let testEventId = 888000 + Math.floor(Math.random() * 999);
    let ruleId: string;

    // Use Service Role Client explicitly
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const body = await request.json();
        console.log('[RuleTest] Received body:', JSON.stringify(body));
        ruleId = body.ruleId;
        const adHocLogic = body.adHocLogic;

        if (!ruleId && !adHocLogic) {
            console.error('[RuleTest] Missing ruleId or adHocLogic in body:', body);
            return NextResponse.json({ success: false, error: 'Missing ruleId or adHocLogic' }, { status: 400 });
        }

        console.log(`[RuleTest] Starting test. ruleId: ${ruleId}, hasAdHoc: ${!!adHocLogic}`);

        // 1. Fetch Rule Info & Status Mappings
        const [ruleRes, { data: statuses }] = await Promise.all([
            adHocLogic ? Promise.resolve({
                data: {
                    code: ruleId || 'adhoc_test_' + Date.now(),
                    logic: adHocLogic,
                    entity_type: body.entity_type || 'order',
                    severity: body.severity || 'medium',
                    name: 'Тестовое правило'
                }, error: null
            }) :
                supabase.from('okk_rules').select('*').eq('code', ruleId).single(),
            supabase.from('statuses').select('code, name')
        ]);

        const rule = ruleRes.data;
        const ruleError = ruleRes.error;
        ruleId = rule?.code || ruleId;

        if (ruleError || !rule) {
            console.error('Rule Fetch Error:', ruleError);
            throw new Error(`Rule ${ruleId} not found. DB Error: ${ruleError?.message}`);
        }

        const nameToCode = new Map((statuses || []).map(s => [s.name.toLowerCase(), s.code]));
        const codeToName = new Map((statuses || []).map(s => [s.code, s.name]));

        // 2. Create Synthetic Data (Smart adaptation to Rule SQL)
        console.log(`[RuleTest] Creating synthetic data...`);
        const sql = rule.condition_sql || '';
        const logic = rule.logic;
        const now = new Date();

        let eventTime = now;
        let eventType = 'status_changed';
        let fieldName = 'status';
        let newValue = 'novyi-1';
        let managerComment = '';

        // CRITICAL: Use manager from rule parameters if specified
        let managerId = 249; // Default fallback
        if (rule.parameters?.manager_ids && Array.isArray(rule.parameters.manager_ids) && rule.parameters.manager_ids.length > 0) {
            managerId = Number(rule.parameters.manager_ids[0]); // Ensure number
        }

        if (logic) {
            // Logic V2 Branch
            console.log('[RuleTest] Parsing Logic V2 blocks...');

            // 1. Trigger
            if (logic.trigger?.block === 'status_change') {
                eventType = 'status_changed';
                fieldName = 'status';
                newValue = logic.trigger.params?.target_status || newValue;
            }

            // 2. Conditions
            if (logic.conditions && Array.isArray(logic.conditions)) {
                for (const cond of logic.conditions) {
                    if (cond.block === 'time_elapsed') {
                        const h = cond.params?.hours || 24;
                        eventTime = new Date(now.getTime() - (h + 1) * 60 * 60 * 1000);
                    }
                    if ((cond.block === 'field_empty' || cond.block === 'no_new_comments') && cond.params?.field_path === 'manager_comment') {
                        managerComment = ''; // Ensure empty for "No comment" rule
                    }
                }
            }
        } else {
            // Legacy SQL Branch
            console.log('[RuleTest] Parsing Legacy SQL...');
            // 1. Time based (e.g. > 24 hours) check
            if (sql.includes('> 24') || sql.includes('> 48') || sql.includes('NOW()') || sql.includes('occurred_at')) {
                // fast forward: make event happen 25h ago
                eventTime = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
            }

            // 2. Event Type & Field Name determination
            if (sql.includes("event_type='status_changed'") || sql.includes("field_name = 'status'")) {
                eventType = 'status_changed';
                fieldName = 'status';
            } else if (sql.includes('next_contact_date') || sql.includes('data_kontakta')) {
                eventType = 'data_kontakta';
                fieldName = 'next_contact_date'; // Use rule-standard name
                const future = new Date();
                future.setDate(future.getDate() + 5);
                newValue = future.toISOString().split('T')[0];
            }

            // 3. Smart Value Extraction
            const newValueEq = sql.match(/new_value\s*=\s*'([^']+)'/i);
            const fieldNameEq = sql.match(/field_name\s*=\s*'([^']+)'/i);

            if (newValueEq) {
                const val = newValueEq[1];
                const mappedCode = nameToCode.get(val.toLowerCase());
                newValue = mappedCode || val;
            } else if (fieldNameEq && fieldNameEq[1] !== 'status') {
                newValue = fieldNameEq[1];
            }

            const inMatch = sql.match(/new_value\s+IN\s*\(([^)]+)\)/i);
            if (inMatch && !newValueEq) {
                const options = inMatch[1].split(',').map((s: string) => s.trim().replace(/'/g, ''));
                if (options.length > 0) {
                    const mappedCode = nameToCode.get(options[0].toLowerCase());
                    newValue = mappedCode || options[0];
                }
            }
        }

        // 4. Special Handling for Context/Comments
        const contextData: any = {
            manager_comment: managerComment,
            status_name: newValue
        };

        if (newValue) {
            const humanFromMap = codeToName.get(newValue);
            if (humanFromMap) {
                contextData.status_name = humanFromMap;
            }
        }

        console.log(`[RuleTest] Generated Synthetic Data: Time=${eventTime.toISOString()}, Type=${eventType}, NewVal=${newValue}`);

        console.log('[RuleTest] Upserting Order...');
        const { error: orderErr } = await supabase.from('orders').upsert({
            id: testOrderId,
            order_id: testOrderId,
            status: fieldName === 'status' ? newValue : 'work',
            manager_id: managerId,
            created_at: eventTime.toISOString(),
            updated_at: eventTime.toISOString()
        });
        if (orderErr) throw new Error(`Order upsert failed: ${orderErr.message}`);

        console.log('[RuleTest] Upserting Metrics...');
        const { error: metricErr } = await supabase.from('order_metrics').upsert({
            retailcrm_order_id: testOrderId,
            manager_id: managerId,
            current_status: fieldName === 'status' ? newValue : 'work',
            full_order_context: contextData
        });
        if (metricErr) throw new Error(`Metrics upsert failed: ${metricErr.message}`);

        const humanName = codeToName.get(newValue) || newValue;
        console.log(`[RuleTest] Upserting Event... Field: ${fieldName}, Value: ${newValue} (${humanName})`);
        const { error: eventErr } = await supabase.from('raw_order_events').upsert({
            event_id: testEventId,
            retailcrm_order_id: testOrderId,
            event_type: eventType,
            occurred_at: eventTime.toISOString(),
            // Ensure manager_id is present
            manager_id: managerId,
            raw_payload: {
                field: fieldName,
                newValue: fieldName === 'status' ? { code: newValue, name: humanName } : newValue,
                oldValue: fieldName === 'status' ? { code: 'work', name: 'Work' } : 'prev_value',
                status: { code: newValue, name: humanName },
                newValue_code: newValue,
                newValue_name: humanName,
                _sync_metadata: { order_statusUpdatedAt: eventTime.toISOString() }
            },
            source: 'synthetic_test'
        });
        if (eventErr) throw new Error(`Event upsert failed: ${eventErr.message}`);

        // Wait a bit for Supabase to persist/index the new event
        await new Promise(r => setTimeout(r, 500));

        // 3. Run Rule Engine
        console.log(`[RuleTest] Executing Rule Engine...`);
        const startTime = new Date(eventTime.getTime() - 2 * 60 * 60 * 1000);
        const endTime = new Date(now.getTime() + 60 * 1000);

        // runRuleEngine needs to use our service client ideally, but it imports utils/supabase. 
        // We cannot change runRuleEngine signature easily here. 
        // But if utils/supabase is configured with SERVICE key in env, it should work.
        // Assuming runRuleEngine works (it seemed to work in my local test).
        // BROADEN THE SEARCH WINDOW FOR THE TEST RUN
        // Scan back 7 days to ensure we catch rules with long delays (e.g. 48h+)
        const longAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const violationsFound = await runRuleEngine(
            longAgo,
            endTime.toISOString(),
            ruleId,
            true, // dryRun = true
            adHocLogic ? rule : undefined
        );

        const violationsCount = typeof violationsFound === 'number' ? violationsFound : (Array.isArray(violationsFound) ? violationsFound.length : 0);

        // In synthetic test, reaching this point with violationsCount > 0 is evidence of success
        const isSuccess = violationsCount > 0;
        const resultMessage = isSuccess
            ? 'Проверка пройдена: Нарушение обнаружено.'
            : 'Проверка не пройдена: Нарушение не зафиксировано.';

        // 5. Log Result
        console.log('[RuleTest] Logging results...');
        const { error: logInsertErr } = await supabase.from('okk_rule_test_logs').insert({
            rule_code: ruleId,
            status: isSuccess ? 'success' : 'failure',
            message: resultMessage,
            details: {
                test_order_id: testOrderId,
                test_event_id: testEventId,
                violations_found_count: violationsCount
            }
        });
        if (logInsertErr) console.error('Log insert failed:', logInsertErr);

        // 6. Cleanup
        console.log(`[RuleTest] Cleaning up...`);
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
        console.error(`[RuleTest] Exception:`, e);

        // Try to log error
        if (ruleId!) {
            const { error: emergencyLogErr } = await supabase.from('okk_rule_test_logs').insert({
                rule_code: ruleId,
                status: 'error',
                message: `Ошибка выполнения теста: ${e.message}`,
                details: { error: e.message || String(e), stack: e.stack }
            });
            if (emergencyLogErr) console.error('Emergency log failed', emergencyLogErr);
        }

        return NextResponse.json({
            success: false,
            error: `API Error: ${e.message}`,
            details: e.stack
        }, { status: 500 });
    }
}
