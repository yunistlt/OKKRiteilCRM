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

    // 1. Fetch Active Rules
    let query = supabase
        .from('okk_rules')
        .select('*')
        .eq('is_active', true);

    if (targetRuleId) {
        query = query.eq('code', targetRuleId);
    }

    const { data: rules, error } = await query;

    if (error || !rules) {
        console.error('[RuleEngine] Failed to fetch rules:', error);
        return;
    }

    console.log(`[RuleEngine] Found ${rules.length} active rules.`);

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
                totalViolations += await executeEventRule(rule, startDate, endDate);
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

async function executeEventRule(rule: any, startDate: string, endDate: string): Promise<number> {
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
        for (const e of events) {
            const orderId = e.retailcrm_order_id;
            // order_metrics can be an array or object depending on join, safely handle it
            const metrics = Array.isArray(e.order_metrics) ? e.order_metrics[0] : e.order_metrics;
            const managerId = metrics?.manager_id;
            const context = metrics?.full_order_context || {};
            const managerComment = context.manager_comment;

            // Basic filtering (date/manager) akin to SQL rules
            const actualEventTime = getActualEventTime(e);
            if (new Date(actualEventTime) < new Date(startDate) || new Date(actualEventTime) > new Date(endDate)) continue;

            // Check allowed managers if params exist
            if (rule.params?.manager_ids?.length > 0) {
                if (!rule.params.manager_ids.includes(managerId) && !rule.params.manager_ids.includes(Number(managerId))) continue;
            }

            console.log(`[RuleEngine] Analyzing comment for Order ${orderId}...`);

            // SPECIAL CASE: If rule checks for empty/null comments, handle directly
            const checksEmptyComment = rule.condition_sql?.includes('manager_comment') &&
                (rule.condition_sql?.includes('IS NULL') || rule.condition_sql?.includes("= ''"));

            if (checksEmptyComment && (!managerComment || managerComment.trim() === '')) {
                // Empty comment IS the violation for this rule type
                console.log(`[RuleEngine] Empty comment detected - immediate violation for Order ${orderId}`);
                semanticViolations++;
                const { error: upsertError } = await supabase.from('okk_violations').upsert({
                    order_id: orderId,
                    rule_code: rule.code,
                    manager_id: managerId,
                    violation_time: actualEventTime,
                    details: 'Отсутствует комментарий менеджера при смене статуса',
                    severity: rule.severity,
                    evidence_text: null,
                    call_id: null
                }, { onConflict: 'order_id, rule_code, call_id' });

                if (upsertError) {
                    console.error('[RuleEngine] Violation Persistence Error:', upsertError);
                }
                continue; // Skip AI analysis for empty comments
            }

            // Substitute variables in prompt
            let prompt = rule.semantic_prompt || rule.description;
            const newValue = (e.raw_payload?.status && typeof e.raw_payload.status === 'object') ? e.raw_payload.status.code : (e.raw_payload?.status || 'unknown');
            prompt = prompt.replace('{{new_value}}', newValue);

            const analysis = await analyzeText(managerComment || '', prompt, 'Manager Comment');

            if (analysis.is_violation) {
                console.log(`[RuleEngine] Violation detected for Order ${orderId}! Reason: ${analysis.reasoning}`);
                semanticViolations++;
                const { error: upsertError } = await supabase.from('okk_violations').upsert({
                    order_id: orderId,
                    rule_code: rule.code,
                    manager_id: managerId,
                    violation_time: actualEventTime,
                    details: analysis.reasoning,
                    severity: rule.severity,
                    evidence_text: analysis.evidence,
                    call_id: null // Explicitly null for event violations
                }, { onConflict: 'order_id, rule_code, call_id' }); // Ensure unique constraint matches DB

                if (upsertError) {
                    console.error('[RuleEngine] Violation Persistence Error:', upsertError);
                }
            }
        }
        return semanticViolations;
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
        // console.log(`[RuleEngine] Filter Loop for ${rule.code}. SQL: ${sql.substring(0, 30)}... Params: ${JSON.stringify(rule.parameters)}`);
        const orderId = e.retailcrm_order_id;
        const managerId = e.order_metrics?.manager_id;

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
                return false;
            }
        }

        const om = {
            current_status: e.order_metrics?.current_status,
            full_order_context: e.order_metrics?.full_order_context || {},
            manager_id: e.order_metrics?.manager_id
        };

        const rawValue = e.raw_payload?.newValue || e.raw_payload?.status;
        const normalizedValue = (typeof rawValue === 'object' && rawValue !== null && 'code' in rawValue)
            ? rawValue.code
            : rawValue;

        const row = {
            field_name: (e.event_type === 'status_changed' || e.raw_payload?.field === 'status' || e.raw_payload?.status) ? 'status' : e.event_type,
            new_value: normalizedValue,
            occurred_at: e.occurred_at,
            om
        };

        // Logic Check
        if (sql.includes("field_name = 'status'") || sql.includes("field_name='status'")) {
            if (row.field_name !== 'status') return false;
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
                    // console.log(`[RuleEngine] SKIP: Not data_kontakta.`);
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

        // Check: new_value = '...' (Strict AND condition)
        const newValueMatch = sql.match(/new_value\s*=\s*'([^']+)'/);
        if (newValueMatch) {
            const requiredValue = newValueMatch[1].toLowerCase();
            if (String(row.new_value).toLowerCase() !== requiredValue) return false;
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
            const foundKey = Object.keys(ctx).find(k => k.toLowerCase() === key);
            return foundKey ? ctx[foundKey] : undefined;
        };

        const hasJsonChecks = nullChecks.length > 0 || emptyChecks.length > 0;

        if (hasJsonChecks) {
            let matchedAny = false;

            // Check IS NULL
            for (const match of nullChecks) {
                const key = match[1]; // key is lowercase from sql
                const val = getContextValue(row.om.full_order_context, key);

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
                    if (val === '') {
                        matchedAny = true;
                        break;
                    }
                }
            }

            // If we have checks, but NONE matched, then the event is "Clean" -> Filter OUT.
            if (!matchedAny) return false;
        }

        return true;
    });

    // --- ASYNC FILTERING FOR COMPLEX RULES ---
    // Some rules (like Rescheduling) need Async DB checks. We do it here on the reduced set.
    const finalViolations = [];
    for (const v of violations) {
        const sql = rule.condition_sql?.toLowerCase() || '';

        if (sql.includes("field_name = 'next_contact_date'")) {
            // Perform the Async Call Check
            // Verify NO CALLS in previous 24h
            const eventTime = new Date(v.occurred_at).getTime();
            const oneDayAgo = new Date(eventTime - 24 * 60 * 60 * 1000).toISOString();
            const timeOfEvent = v.occurred_at;

            // Check Outgoing Calls via Matches
            const { count, error } = await supabase
                .from('call_order_matches')
                .select('match_id, raw_telphin_calls!inner(direction, started_at)', { count: 'exact', head: true })
                .eq('retailcrm_order_id', v.retailcrm_order_id)
                .filter('raw_telphin_calls.started_at', 'gte', oneDayAgo)
                .filter('raw_telphin_calls.started_at', 'lte', timeOfEvent)
                .filter('raw_telphin_calls.direction', 'eq', 'outgoing');
            // User said "не выполнение действий", usually means outgoing. Let's stick to outgoing first.

            if (!error && count !== null && count > 0) {
                console.log(`[RuleEngine] Order ${v.retailcrm_order_id}: Found ${count} calls. Not a violation.`);
                continue; // Found calls, skip validation
            }
            // Add check for Emails later if needed...
        }

        finalViolations.push(v);
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

    let saved = 0;
    for (const record of records) {
        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(record, { onConflict: 'rule_code, order_id, violation_time, call_id' });

        if (!insError) {
            saved++;
        } else if (insError.code === '23505') {
            // Already exists
        } else {
            console.error(`[RuleEngine] Error saving order ${record.order_id}:`, insError);
        }
    }
    console.log(`[RuleEngine] Successfully saved ${saved} violations for rule ${rule.code}.`);
    return saved;
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

    let saved = 0;
    for (const record of records) {
        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(record, { onConflict: 'rule_code, call_id' });

        if (!insError) saved++;
        else if (insError.code !== '23505') {
            console.error(`[RuleEngine] Error saving call violation:`, insError);
        }
    }
    return saved;
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

    let saved = 0;
    const params = rule.parameters || {};

    for (const c of calls) {
        const match = c.call_order_matches?.[0];
        if (!match) continue;

        const orderId = match.order_id;
        const managerId = match.orders?.manager_id;

        // Filter by Manager ID
        if (params.manager_ids && params.manager_ids.length > 0) {
            if (!managerId || !params.manager_ids.includes(managerId)) continue;
        }

        // Filter by Order ID
        if (params.order_ids && params.order_ids.length > 0) {
            if (!orderId || !params.order_ids.includes(orderId)) continue;
        }

        const result = await analyzeTranscript(c.transcript, rule.semantic_prompt || rule.description);

        if (result.is_violation) {
            const dirLabel = c.direction === 'incoming' ? 'входящий' : (c.direction === 'outgoing' ? 'исходящий' : c.direction);
            const { error: insError } = await supabase
                .from('okk_violations')
                .upsert({
                    rule_code: rule.code,
                    call_id: c.event_id,
                    order_id: match.order_id,
                    manager_id: match.orders?.manager_id,
                    violation_time: c.started_at,
                    severity: rule.severity,
                    details: `Звонок: ${dirLabel}, ${c.duration_sec} сек. Анализ: ${result.reasoning}`,
                    evidence_text: result.evidence
                }, { onConflict: 'rule_code, call_id' });

            if (!insError) saved++;
        }
    }
    return saved;
}
