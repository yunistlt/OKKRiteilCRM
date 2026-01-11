
import { supabase } from '@/utils/supabase';
import { analyzeTranscript } from './semantic';

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
        const orderId = e.retailcrm_order_id;
        const managerId = e.order_metrics?.manager_id;

        // Skip events without metadata (old events with potentially incorrect timestamps)
        if (!e.raw_payload?._sync_metadata) {
            console.log(`[RuleEngine] Skipping event ${e.event_id} - no sync metadata`);
            return false;
        }

        // IMPORTANT: Check if event actually occurred within the time range
        const actualEventTime = getActualEventTime(e);
        const eventDate = new Date(actualEventTime);
        const rangeStart = new Date(startDate);
        const rangeEnd = new Date(endDate);

        if (eventDate < rangeStart || eventDate > rangeEnd) {
            return false;
        }

        const params = rule.parameters || {};

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

        // Check Manager Comment
        if (sql.includes("manager_comment")) {
            const comment = om.full_order_context?.manager_comment;
            const isEmpty = !comment || String(comment).trim() === '' || String(comment).trim() === 'null';
            if (!isEmpty) return false; // Has comment -> NOT a violation
        }

        return true;
    });

    console.log(`[RuleEngine] Filtered ${violations.length} violations for rule ${rule.code}.`);

    if (violations.length > 0) {
        const records = violations.map((v: any) => ({
            rule_code: rule.code,
            order_id: v.retailcrm_order_id,
            manager_id: v.order_metrics?.manager_id,
            violation_time: v.occurred_at,
            severity: rule.severity,
            details: `Событие: ${v.event_type === 'status_changed' ? 'Смена статуса' : v.event_type}. ${rule.description || rule.name}`
        }));

        let saved = 0;
        console.log(`[RuleEngine] Attempting to save ${records.length} records...`);
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const { error: insError } = await supabase
                .from('okk_violations')
                .upsert(record, { onConflict: 'rule_code, order_id, violation_time' });

            if (!insError) {
                saved++;
                console.log(`[RuleEngine] [${i + 1}/${records.length}] Saved violation for order ${record.order_id}`);
            } else if (insError.code === '23505') {
                console.log(`[RuleEngine] [${i + 1}/${records.length}] Duplicate for order ${record.order_id} skipped.`);
            } else {
                console.error(`[RuleEngine] [${i + 1}/${records.length}] Error saving order ${record.order_id}:`, insError);
            }
        }
        console.log(`[RuleEngine] Successfully saved ${saved} violations for rule ${rule.code}.`);
        return saved;
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
