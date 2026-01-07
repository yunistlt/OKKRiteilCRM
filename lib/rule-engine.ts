
import { supabase } from '@/utils/supabase';

export interface Rule {
    code: string;
    entity_type: 'call' | 'order' | 'event';
    condition_sql: string;
    params: Record<string, any>;
    severity: string;
}

/**
 * Execute all active rules against a time range.
 * Currently supports 'call' entity type fully.
 */
export async function runRuleEngine(startDate: string, endDate: string, targetRuleId?: number) {
    console.log(`[RuleEngine] Running for range ${startDate} to ${endDate} ${targetRuleId ? `(Target Rule: ${targetRuleId})` : ''}`);

    // 1. Fetch Active Rules
    let query = supabase
        .from('okk_rules')
        .select('*')
        .eq('is_active', true);

    if (targetRuleId) {
        query = query.eq('id', targetRuleId);
    }

    const { data: rules, error } = await query;

    if (error || !rules) {
        console.error('[RuleEngine] Failed to fetch rules:', error);
        return;
    }

    console.log(`[RuleEngine] Found ${rules.length} active rules.`);

    console.log(`[RuleEngine] Found ${rules.length} active rules.`);

    // 2. Execute per entity type
    let totalViolations = 0;
    for (const rule of rules) {
        try {
            if (rule.entity_type === 'call') {
                totalViolations += await executeCallRule(rule, startDate, endDate);
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
    const sql = rule.condition_sql.toLowerCase();
    let monitoredStatuses: string[] = [];
    if (sql.includes('@monitored_statuses')) {
        const { data: stData } = await supabase.from('statuses').select('code').eq('is_working', true);
        monitoredStatuses = (stData || []).map(s => s.code);
    }

    // 3. Filter Violations
    const violations = events.filter((e: any) => {
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

    if (violations.length > 0) {
        console.log(`[RuleEngine] ${rule.code} -> Found ${violations.length} event violations.`);

        const records = violations.map((v: any) => ({
            rule_code: rule.code,
            order_id: v.retailcrm_order_id,
            manager_id: v.order_metrics?.manager_id,
            violation_time: v.occurred_at,
            severity: rule.severity,
            details: `Событие: ${v.event_type === 'status_changed' ? 'Смена статуса' : v.event_type}. ${rule.description || rule.name}`
        }));

        // Try upserting one by one to avoid batch failure on unique constraint
        let saved = 0;
        for (const record of records) {
            const { error: insError } = await supabase
                .from('okk_violations')
                .upsert(record, { onConflict: 'rule_code, order_id, violation_time' });

            if (!insError) saved++;
            // Ignore duplicate key errors silently, log others
            else if (insError.code !== '23505') {
                console.error(`[RuleEngine] Error saving event violation:`, insError);
            }
        }

        console.log(`[RuleEngine] ${rule.code} -> Saved ${saved}/${records.length} violations.`);
        return saved;
    }
    return 0;
}

async function executeCallRule(rule: any, startDate: string, endDate: string): Promise<number> {
    console.log(`[RuleEngine] Executing Call Rule: ${rule.code} (${rule.name})`);

    let query = supabase
        .from('raw_telphin_calls')
        .select('*')
        .gte('started_at', startDate)
        .lte('started_at', endDate);

    const { data: calls, error } = await query;
    if (error) {
        console.error(`Error fetching calls for ${rule.code}:`, error);
        return 0;
    }

    if (!calls || calls.length === 0) return 0;

    const sql = rule.condition_sql.toLowerCase();
    const params = rule.parameters || {};

    const violations = calls.filter((c: any) => {
        // missed_incoming logic: flow = 'incoming' AND duration = 0
        if (sql.includes("flow = 'incoming'") || sql.includes("direction = 'incoming'")) {
            if (c.direction !== 'incoming') return false;
            if (sql.includes("duration = 0") || sql.includes("duration_sec = 0")) {
                return (c.duration_sec === 0);
            }
        }

        // short_call logic
        if (sql.includes("duration <") || sql.includes("duration_sec <")) {
            const threshold = params.threshold_sec || 15;
            return c.duration_sec > 0 && c.duration_sec < threshold;
        }

        // answering_machine_dialog logic
        if (sql.includes("is_answering_machine = true")) {
            if (c.is_answering_machine !== true) return false;
            const threshold = params.threshold_sec || 15;
            return c.duration_sec > threshold;
        }

        // call_impersonation logic: duration > 0 AND duration < 5 AND is_answering_machine IS NOT true
        if (sql.includes("is_answering_machine is distinct from true") || sql.includes("is_answering_machine is not true")) {
            if (c.is_answering_machine === true) return false;
            // The rest of logic (duration) will be handled by short_call block if combined? 
            // Better to handle specifically if requested.
        }

        return false;
    });

    if (violations.length > 0) {
        console.log(`[RuleEngine] ${rule.code} -> Found ${violations.length} call violations.`);

        const records = violations.map(c => {
            const dirLabel = c.direction === 'incoming' ? 'входящий' : (c.direction === 'outgoing' ? 'исходящий' : c.direction);
            return {
                rule_code: rule.code,
                call_id: c.event_id,
                violation_time: c.started_at,
                severity: rule.severity,
                details: `Звонок: ${dirLabel}, ${c.duration_sec} сек. ${rule.description || rule.name}`
            };
        });

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

        console.log(`[RuleEngine] ${rule.code} -> Saved ${saved}/${violations.length} violations.`);
        return saved;
    }
    return 0;
}
