import { supabase } from '@/utils/supabase';
import { analyzeTranscript, analyzeText } from './semantic';

export interface Rule {
    code: string;
    entity_type: 'call' | 'order' | 'event';
    condition_sql: string;
    params: Record<string, any>;
    severity: string;
    rule_type?: 'sql' | 'semantic';
    semantic_prompt?: string;
    name: string;
    description: string;
}

/**
 * Execute all active rules against a time range.
 */
export async function runRuleEngine(startDate: string, endDate: string, targetRuleId?: string) {
    console.log(`[RuleEngine] Running for range ${startDate} to ${endDate} ${targetRuleId ? `(Target Rule: ${targetRuleId})` : ''}`);

    // 1. Fetch Active Rules and Status Mappings
    const statusesPromise = supabase.from('statuses').select('code, name');
    let rulesQuery = supabase
        .from('okk_rules')
        .select('*')
        .eq('is_active', true);

    if (targetRuleId) {
        rulesQuery = rulesQuery.eq('code', targetRuleId);
    }

    const [{ data: rules, error: rulesError }, { data: statuses }] = await Promise.all([
        rulesQuery,
        statusesPromise
    ]);

    if (rulesError || !rules) {
        console.error('[RuleEngine] Failed to fetch rules:', rulesError);
        return;
    }

    const statusMap = new Map((statuses || []).map(s => [s.name.toLowerCase(), s.code]));
    console.log(`[RuleEngine] Found ${rules.length} active rules and ${statuses?.length} status mappings.`);

    // 2. Execute per entity type
    let totalViolations = 0;
    for (const rule of rules) {
        try {
            if (rule.entity_type === 'call') {
                if (rule.rule_type === 'semantic') {
                    totalViolations += await executeSemanticRule(rule, startDate, endDate);
                } else {
                    totalViolations += await executeCallRule(rule, startDate, endDate);
                }
            } else if (rule.entity_type === 'event') {
                totalViolations += await executeEventRule(rule, startDate, endDate, statusMap);
            } else {
                console.log(`[RuleEngine] Skipping unsupported entity type: ${rule.entity_type} (${rule.code})`);
            }
        } catch (e) {
            console.error(`[RuleEngine] Error executing rule ${rule.code}:`, e);
        }
    }
    return totalViolations;
}

/**
 * Helper: Get the actual event time from raw_payload metadata
 * Falls back to occurred_at if no better timestamp is available
 */
function getActualEventTime(event: any): string {
    // Try to get the real event time from order's statusUpdatedAt
    const metadata = event.raw_payload?._sync_metadata;
    if (metadata?.order_statusUpdatedAt) {
        return metadata.order_statusUpdatedAt;
    }

    // Fallback to occurred_at (which might be the API createdAt)
    return event.occurred_at;
}

async function executeEventRule(rule: any, startDate: string, endDate: string, statusMap?: Map<string, string>): Promise<number> {
    console.log(`[RuleEngine] Executing Event Rule: ${rule.code} (${rule.name})`);
    console.log(`[RuleEngine] Rule SQL: ${rule.condition_sql}`);

    // 1. Fetch Events
    let query = supabase
        .from('raw_order_events')
        .select(`
            event_id,
            event_type,
            raw_payload,
            occurred_at,
            retailcrm_order_id,
            order_metrics!left ( current_status, manager_id, full_order_context )
        `)
        .gte('occurred_at', startDate)
        .lte('occurred_at', endDate);

    const { data: events, error } = await query;
    if (error) {
        console.error(`Error fetching events for ${rule.code}:`, error);
        return 0;
    }
    console.log(`[RuleEngine] Fetched ${events?.length} events for analysis.`);

    // 2. Prepare for Semantic Analysis (if needed)
    let semanticViolations = 0;
    if (rule.rule_type === 'semantic') {
        console.log(`[RuleEngine] Semantic Analysis (Event) for ${rule.code}`);
        const semanticTasks = events.map(async (e) => {
            const orderId = e.retailcrm_order_id;
            const metrics = Array.isArray(e.order_metrics) ? e.order_metrics[0] : e.order_metrics;
            const managerId = metrics?.manager_id;
            const context = metrics?.full_order_context || {};
            const managerComment = context.manager_comment;

            const actualEventTime = getActualEventTime(e);
            if (new Date(actualEventTime) < new Date(startDate) || new Date(actualEventTime) > new Date(endDate)) return null;

            const ruleParams = rule.parameters || {};
            if (ruleParams.manager_ids?.length > 0) {
                if (!ruleParams.manager_ids.includes(managerId) && !ruleParams.manager_ids.includes(Number(managerId))) {
                    console.log(`[RuleEngine] Rule ${rule.code}: Manager ${managerId} not in monitored list:`, ruleParams.manager_ids);
                    return null;
                }
            }

            const checksEmptyComment = rule.condition_sql?.toLowerCase().includes('manager_comment') &&
                (rule.condition_sql?.includes('IS NULL') || rule.condition_sql?.includes("= ''"));

            if (checksEmptyComment && (!managerComment || managerComment.trim() === '')) {
                console.log(`[RuleEngine] Rule ${rule.code}: Violation detected (Empty Comment) for Order ${orderId}`);
                return {
                    order_id: orderId,
                    rule_code: rule.code,
                    manager_id: managerId,
                    violation_time: actualEventTime,
                    details: 'Отсутствует комментарий менеджера при смене статуса',
                    severity: rule.severity,
                    evidence_text: null,
                    call_id: null
                };
            }

            let semanticPrompt = rule.semantic_prompt || rule.description;
            const sRawVal = e.raw_payload?.newValue || e.raw_payload?.status;
            const newValue = (typeof sRawVal === 'object' && sRawVal !== null && 'code' in sRawVal)
                ? sRawVal.code
                : (sRawVal || 'unknown');

            semanticPrompt = semanticPrompt.replace('{{new_value}}', newValue);

            try {
                const analysis = await analyzeText(managerComment || '', semanticPrompt, 'Manager Comment');
                if (analysis.is_violation) {
                    return {
                        order_id: orderId,
                        rule_code: rule.code,
                        manager_id: managerId,
                        violation_time: actualEventTime,
                        details: analysis.reasoning,
                        severity: rule.severity,
                        evidence_text: analysis.evidence,
                        call_id: null
                    };
                }
            } catch (err) {
                console.error(`[RuleEngine] Semantic AI Error for Order ${orderId}:`, err);
            }
            return null;
        });

        const results = await Promise.all(semanticTasks);
        const violationsToSave = results.filter((v): v is any => v !== null);

        if (violationsToSave.length > 0) {
            console.log(`[RuleEngine] Rule ${rule.code}: Saving ${violationsToSave.length} semantic violations.`);
            const { error: upsertError } = await supabase.from('okk_violations').upsert(violationsToSave, {
                onConflict: 'rule_code, order_id, violation_time, call_id'
            });
            if (upsertError) console.error(`[RuleEngine] Rule ${rule.code} (Semantic) Batch Upsert Error:`, upsertError);
            return violationsToSave.length;
        }
        return 0;
    }

    if (!events || events.length === 0) return 0;

    // 2. Prepare Context (e.g. Monitored Statuses)
    const sql = rule.condition_sql?.toLowerCase() || '';
    let monitoredStatuses: string[] = [];
    if (sql.includes('@monitored_statuses')) {
        const { data: stData } = await supabase.from('statuses').select('code').eq('is_working', true);
        monitoredStatuses = (stData || []).map(s => s.code);
    }

    // 3. Filter Violations
    const violations = events.filter((e: any) => {
        const metricsRaw = Array.isArray(e.order_metrics) ? e.order_metrics[0] : e.order_metrics;
        const orderId = e.retailcrm_order_id;
        const managerId = metricsRaw?.manager_id;

        // Skip events without metadata (old events with potentially incorrect timestamps)
        if (!e.raw_payload?._sync_metadata) {
            return false;
        }

        const actualEventTime = getActualEventTime(e);
        const eventDate = new Date(actualEventTime);
        const rangeStart = new Date(startDate);
        const rangeEnd = new Date(endDate);

        if (eventDate < rangeStart || eventDate > rangeEnd) {
            return false;
        }

        const params = rule.parameters || {};

        if (params.manager_ids?.length > 0) {
            if (!params.manager_ids.includes(managerId) && !params.manager_ids.includes(Number(managerId))) {
                console.log(`[RuleEngine] Rule ${rule.code}: Manager ${managerId} not in expected list [${params.manager_ids}]. Event skipped.`);
                return false;
            }
        }

        const om = {
            current_status: metricsRaw?.current_status,
            full_order_context: metricsRaw?.full_order_context || {},
            manager_id: metricsRaw?.manager_id
        };

        const rawValue = e.raw_payload?.newValue || e.raw_payload?.status;
        const normalizedValue = (typeof rawValue === 'object' && rawValue !== null && 'code' in rawValue)
            ? rawValue.code
            : rawValue;
        const normalizedName = (typeof rawValue === 'object' && rawValue !== null && 'name' in rawValue)
            ? rawValue.name
            : null;

        const row = {
            field_name: (e.event_type === 'status_changed' || e.raw_payload?.field === 'status' || e.raw_payload?.status) ? 'status' : e.event_type,
            new_value: normalizedValue,
            new_name: normalizedName,
            occurred_at: e.occurred_at,
            om
        };

        // Normalize some field names for matching (RetailCRM names vs our event names)
        if (row.field_name === 'data_kontakta') row.field_name = 'next_contact_date';

        // 4. Manual Logic Overrides for complex rules
        // Check: field_name = 'X' (Strict check if provided in SQL)
        const fieldMatch = sql.match(/field_name\s*=\s*'([^']+)'/);
        if (fieldMatch) {
            const req = fieldMatch[1].toLowerCase();
            const actual = row.field_name.toLowerCase();
            if (req !== actual) {
                // Special case: SQL might use 'data_kontakta'.
                if (req === 'data_kontakta' && actual === 'next_contact_date') {
                    // okay
                } else if (req === 'next_contact_date' && actual === 'data_kontakta') {
                    // okay
                } else {
                    console.log(`[RuleEngine] Rule ${rule.code}: Field name mismatch. Req: ${req}, Actual: ${actual}`);
                    return false;
                }
            }
        }

        // Logic Check
        if (sql.includes("field_name = 'status'") || sql.includes("field_name='status'")) {
            if (row.field_name !== 'status') {
                console.log(`[RuleEngine] Rule ${rule.code}: Not a status event.`);
                return false;
            }
        }

        // Macro: @monitored_statuses
        if (sql.includes('@monitored_statuses')) {
            if (!monitoredStatuses.includes(row.new_value)) return false;
        }

        // Logic Rule: Unjustified Rescheduling (Next Contact Date)
        // console.log(`[RuleEngine] Checking IF condition for 'next_contact_date'. Includes: ${sql.includes('next_contact_date')}`);
        if (sql.includes('next_contact_date')) {
            // 1. Check if event is a change of 'data_kontakta'
            try {
                // console.log(`[RuleEngine] Checking match logic. event_type=${e.event_type}, raw_payload=${JSON.stringify(e.raw_payload)}`);

                const isTargetField =
                    e.event_type === 'data_kontakta' ||
                    (e.event_type === 'customFields' && e.raw_payload?.field === 'data_kontakta') ||
                    (e.raw_payload?.field === 'data_kontakta');

                if (!isTargetField) {
                    console.log(`[RuleEngine] Rule ${rule.code}: Not a contact date event. Skipped.`);
                    return false;
                }
                // console.log('[RuleEngine] MATCHED field!');
            } catch (err) {
                console.error('[RuleEngine] Error in match logic:', err);
                return false;
            }

            // 2. Determine timestamps
            const eventTime = new Date(e.occurred_at).getTime();
            const oneDayAgo = new Date(eventTime - 24 * 60 * 60 * 1000).toISOString();

            // 3. We can't easily query DB *inside* this filter loop efficiently without N+1.
            // However, for this specific rule, we MUST check for calls.
            // OPTIMIZATION: We fetch calls for this order ONCE before filter? No, difficult.
            // Hack solution for prototype: We will rely on 'violations' being filtered first by field type, 
            // then we do the async check in the MAPPING phase or separate Loop.
            // LIMITATION: 'filter' function is synchronous. We cannot await DB calls here.
            // FIX: We will return TRUE here to include it as a "Potential Candidate", 
            // and filter it out during the DB persistence phase if calls exist.
            return true;
        }

        // Check Manager Comment
        if (sql.includes("manager_comment")) {
            const comment = om.full_order_context?.manager_comment;
            const isEmpty = !comment || String(comment).trim() === '' || String(comment).trim() === 'null';
            if (!isEmpty) return false; // Has comment -> NOT a violation
        }

        // 5. Generic SQL Logic Check (Regex-based approximation)
        // This is a safety net for rules that aren't hardcoded above.
        // We check for common patterns: new_value = 'X', context->>'Y' IS NULL, etc.

        // Match code or name from mapping
        const newValueMatch = sql.match(/new_value\s*=\s*'([^']+)'/);
        if (newValueMatch) {
            const requiredValue = newValueMatch[1].toLowerCase();
            const valMatch = String(row.new_value).toLowerCase();
            const nameMatch = row.new_name ? String(row.new_name).toLowerCase() : null;

            // 1. Direct match (code or name)
            if (valMatch === requiredValue || nameMatch === requiredValue) {
                // matched
            } else {
                // 2. Lookup mapping (if requiredValue is a name, find the code)
                const mappedCode = statusMap?.get(requiredValue);
                if (mappedCode && mappedCode.toLowerCase() === valMatch) {
                    // matched via mapping
                } else {
                    return false;
                }
            }
        }

        // JSON Checks: Usually "Bad Conditions". If ANY match, it's a violation.
        // If checks define what constitutes a violation (e.g. "IS NULL"), 
        // then finding ONE true check justifies the violation.
        const nullChecks = [...sql.matchAll(/om\.full_order_context->>'([^']+)'\s+is\s+null/gi)];
        const emptyChecks = [...sql.matchAll(/om\.full_order_context->>'([^']+)'\s*=\s*''/gi)];

        // Helper for case-insensitive lookup
        const getContextValue = (ctx: any, key: string) => {
            if (!ctx) return undefined;
            // distinct lowercase lookup
            const targetKey = String(key).toLowerCase();
            const foundKey = Object.keys(ctx).find(k => k.toLowerCase() === targetKey);
            return foundKey ? ctx[foundKey] : undefined;
        };

        const hasJsonChecks = nullChecks.length > 0 || emptyChecks.length > 0;

        if (hasJsonChecks) {
            let matchedAny = false;

            // Check IS NULL
            for (const match of nullChecks) {
                const key = match[1]; // key is lowercase from sql
                const val = getContextValue(row.om.full_order_context, key);
                // console.log(`[RuleEngine] Checking NULL for '${key}'. Value:`, val);

                if (val === undefined || val === null) {
                    matchedAny = true;
                    break;
                }
            }

            // Check = ''
            if (!matchedAny) {
                for (const match of emptyChecks) {
                    const key = match[1];
                    const val = getContextValue(row.om.full_order_context, key);
                    // console.log(`[RuleEngine] Checking EMPTY for '${key}'. Value: '${val}'`);
                    if (val === '') {
                        matchedAny = true;
                        break;
                    }
                }
            }

            // console.log(`[RuleEngine] JSON Checks result: matchedAny=${matchedAny}`);

            // If we have checks, but NONE matched, then the event is "Clean" -> Filter OUT.
            if (!matchedAny) {
                // console.log(`[RuleEngine] Rule ${rule.code}: Order ${orderId} - All JSON checks failed. Event is clean.`);
                return false;
            }
        }

        // 6. Time-based Logic Check (NOW() - INTERVAL)
        // Example: occurred_at < NOW() - INTERVAL '24 hours'
        const timeMatch = sql.match(/occurred_at\s*<\s*now\(\)\s*-\s*interval\s*'(\d+)\s+hours'/i);
        if (timeMatch) {
            const hoursThreshold = parseInt(timeMatch[1]);
            const eventTime = new Date(getActualEventTime(e)).getTime();
            const thresholdTime = Date.now() - (hoursThreshold * 60 * 60 * 1000);

            if (eventTime > thresholdTime) {
                // Event is too recent -> skip
                return false;
            }
        }

        console.log(`[RuleEngine] Rule ${rule.code}: SUCCESS! Violation confirmed for Order ${orderId}`);
        return true;
    });

    // --- ASYNC FILTERING FOR COMPLEX RULES ---
    // Batch process complex rules (like Rescheduling) to avoid N+1 queries
    let finalViolations = Array.from(violations);
    if (sql.includes("field_name = 'next_contact_date'")) {
        console.log(`[RuleEngine] Batch checking calls for ${violations.length} potential 'next_contact_date' violations...`);

        // 1. Collect all orders and time ranges
        const orderIds = Array.from(new Set(violations.map((v: any) => v.retailcrm_order_id)));

        // 2. Fetch all matches for these orders in the relevant overall range
        // Note: For precision we could do per-event, but fetching all 24h calls for these orders is faster.
        const { data: matches } = await supabase
            .from('call_order_matches')
            .select('retailcrm_order_id, raw_telphin_calls!inner(direction, started_at)')
            .in('retailcrm_order_id', orderIds)
            .eq('raw_telphin_calls.direction', 'outgoing')
            .gte('raw_telphin_calls.started_at', new Date(new Date(startDate).getTime() - 24 * 60 * 60 * 1000).toISOString())
            .lte('raw_telphin_calls.started_at', endDate);

        // 3. Filter out those who actually DID have a call in their specific 24h window
        finalViolations = violations.filter((v: any) => {
            const eventTime = new Date(v.occurred_at).getTime();
            const oneDayAgo = eventTime - 24 * 60 * 60 * 1000;

            const hasCall = matches?.some((m: any) => {
                const call = Array.isArray(m.raw_telphin_calls) ? m.raw_telphin_calls[0] : m.raw_telphin_calls;
                if (!call) return false;
                return m.retailcrm_order_id === v.retailcrm_order_id &&
                    new Date(call.started_at).getTime() >= oneDayAgo &&
                    new Date(call.started_at).getTime() <= eventTime;
            });

            return !hasCall;
        });
    }

    console.log(`[RuleEngine] Filtered ${finalViolations.length} violations for rule ${rule.code}.`);

    const records = finalViolations.map((v: any) => ({
        rule_code: rule.code,
        order_id: v.retailcrm_order_id,
        manager_id: v.order_metrics?.manager_id,
        violation_time: v.occurred_at,
        call_id: null, // Critical: must be null for event violations
        severity: rule.severity,
        details: `Событие: ${v.event_type === 'status_changed' ? 'Смена статуса' : v.event_type}. ${rule.description || rule.name}`
    }));

    if (records.length > 0) {
        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(records, { onConflict: 'rule_code, order_id, violation_time, call_id' });

        if (insError) {
            console.error(`[RuleEngine] Error saving batch violations for ${rule.code}:`, insError);
        } else {
            console.log(`[RuleEngine] Successfully saved ${records.length} violations for rule ${rule.code}.`);
            return records.length;
        }
    }
    return 0;
}

async function executeCallRule(rule: any, startDate: string, endDate: string): Promise<number> {
    console.log(`[RuleEngine] Executing Call Rule: ${rule.code} (${rule.name})`);

    let query = supabase
        .from('raw_telphin_calls')
        .select(`
            *,
            call_order_matches(
                order_id: retailcrm_order_id,
                orders(manager_id)
            )
        `)
        .gte('started_at', startDate)
        .lte('started_at', endDate);

    const { data: calls, error } = await query;
    if (error) {
        console.error(`Error fetching calls for ${rule.code}:`, error);
        return 0;
    }

    if (!calls || calls.length === 0) return 0;

    const sql = rule.condition_sql?.toLowerCase() || '';
    const params = rule.parameters || {};

    const violations = calls.filter((c: any) => {
        const match = c.call_order_matches?.[0];
        const orderId = match?.order_id;
        const managerId = match?.orders?.manager_id;

        // Filter by Manager ID
        if (params.manager_ids && params.manager_ids.length > 0) {
            if (!managerId || !params.manager_ids.includes(managerId)) return false;
        }

        // Filter by Order ID
        if (params.order_ids && params.order_ids.length > 0) {
            if (!orderId || !params.order_ids.includes(orderId)) return false;
        }

        if (rule.rule_type === 'semantic') return false;

        if (sql.includes("flow = 'incoming'") || sql.includes("direction = 'incoming'") || sql.includes("call_type = 'incoming'")) {
            if (c.direction !== 'incoming') return false;
            if (sql.includes("duration = 0") || sql.includes("duration_sec = 0")) {
                return (c.duration_sec === 0);
            }
        }

        if (sql.includes("duration <") || sql.includes("duration_sec <")) {
            const thresholdMatch = sql.match(/duration_sec\s*<\s*(\d+)/) || sql.match(/duration\s*<\s*(\d+)/);
            const threshold = thresholdMatch ? parseInt(thresholdMatch[1]) : (params.threshold_sec || 15);
            return c.duration_sec > 0 && c.duration_sec < threshold;
        }

        if (sql.includes("is_answering_machine = true") || sql.includes("is_answering_machine=true")) {
            if (c.is_answering_machine !== true) return false;
            const threshold = params.threshold_sec || 15;
            return c.duration_sec > threshold;
        }

        if (sql.includes("call_type = 'outgoing'") || sql.includes("direction = 'outgoing'")) {
            if (c.direction !== 'outgoing') return false;
            if (sql.includes("status = 'success'") && c.duration_sec > 0) return true;
        }

        return false;
    });

    const records = violations
        .map(c => {
            const match = c.call_order_matches?.[0];
            const dirLabel = c.direction === 'incoming' ? 'входящий' : (c.direction === 'outgoing' ? 'исходящий' : c.direction);
            return {
                rule_code: rule.code,
                call_id: c.event_id,
                order_id: match?.order_id || null,
                manager_id: match?.orders?.manager_id || null,
                violation_time: c.started_at,
                severity: rule.severity,
                details: `Звонок: ${dirLabel}, ${c.duration_sec} сек. ${rule.description || rule.name}`
            };
        })
        .filter(r => r.order_id !== null);

    if (records.length > 0) {
        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(records, { onConflict: 'rule_code, call_id' });

        if (insError) {
            console.error(`[RuleEngine] Error saving batch call violations:`, insError);
        } else {
            return records.length;
        }
    }
    return 0;
}

async function executeSemanticRule(rule: any, startDate: string, endDate: string): Promise<number> {
    console.log(`[RuleEngine] Executing Semantic Rule: ${rule.code} (${rule.name})`);

    const { data: calls } = await supabase
        .from('raw_telphin_calls')
        .select(`
            *,
            call_order_matches(
                order_id: retailcrm_order_id,
                orders(manager_id)
            )
        `)
        .gte('started_at', startDate)
        .lte('started_at', endDate)
        .not('transcript', 'is', null);

    if (!calls || calls.length === 0) return 0;

    const params = rule.parameters || {};
    const semanticTasks = calls.map(async (c) => {
        const match = c.call_order_matches?.[0];
        if (!match) return null;

        const orderId = match.order_id;
        const managerId = match.orders?.manager_id;

        if (params.manager_ids && params.manager_ids.length > 0) {
            if (!managerId || !params.manager_ids.includes(managerId)) return null;
        }

        if (params.order_ids && params.order_ids.length > 0) {
            if (!orderId || !params.order_ids.includes(orderId)) return null;
        }

        try {
            const result = await analyzeTranscript(c.transcript, rule.semantic_prompt || rule.description);
            if (result.is_violation) {
                const dirLabel = c.direction === 'incoming' ? 'входящий' : (c.direction === 'outgoing' ? 'исходящий' : c.direction);
                return {
                    rule_code: rule.code,
                    call_id: c.event_id,
                    order_id: match.order_id,
                    manager_id: match.orders?.manager_id,
                    violation_time: c.started_at,
                    severity: rule.severity,
                    details: `Звонок: ${dirLabel}, ${c.duration_sec} сек. Анализ: ${result.reasoning}`,
                    evidence_text: result.evidence
                };
            }
        } catch (err) {
            console.error(`[RuleEngine] Semantic AI Error for Call ${c.event_id}:`, err);
        }
        return null;
    });

    const results = await Promise.all(semanticTasks);
    const violationsToSave = results.filter((v): v is any => v !== null);

    if (violationsToSave.length > 0) {
        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(violationsToSave, { onConflict: 'rule_code, call_id' });

        if (insError) console.error('[RuleEngine] Semantic Call Batch Upsert Error:', insError);
        return violationsToSave.length;
    }
    return 0;
}
