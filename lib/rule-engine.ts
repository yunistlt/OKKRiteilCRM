
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

        // Condition matching: "field_name = 'status' AND ... manager_comment ..."
        const sql = rule.condition_sql.toLowerCase();

        if (sql.includes("field_name = 'status'") || sql.includes("field_name='status'")) {
            if (row.field_name !== 'status') return false;
        }

        if (sql.includes("manager_comment")) {
            const comment = om.full_order_context?.manager_comment;
            const isEmpty = !comment || String(comment).trim() === '' || String(comment).trim() === 'null';
            if (isEmpty) return true;
        }

        return false;
    });

    if (violations.length > 0) {
        console.log(`[RuleEngine] ${rule.code} -> Found ${violations.length} violations.`);

        const records = violations.map((v: any) => ({
            rule_code: rule.code,
            order_id: v.retailcrm_order_id,
            manager_id: v.order_metrics?.manager_id,
            violation_time: v.occurred_at,
            severity: rule.severity,
            details: `Событие: ${v.event_type}. ${rule.description || rule.name}`
        }));

        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(records, { onConflict: 'rule_code, order_id, violation_time' });

        if (insError) console.error(`Error saving violations for ${rule.code}:`, insError);
        return violations.length;
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

        // successful outgoing
        if (sql.includes("call_type = 'outgoing'") || sql.includes("direction = 'outgoing'")) {
            if (c.direction !== 'outgoing') return false;
            if (sql.includes("status = 'success'")) {
                return c.duration_sec > 0;
            }
        }

        return false;
    });

    if (violations.length > 0) {
        console.log(`[RuleEngine] ${rule.code} -> Found ${violations.length} violations.`);

        const records = violations.map(c => ({
            rule_code: rule.code,
            call_id: c.event_id,
            violation_time: c.started_at,
            severity: rule.severity,
            details: `Звонок: ${c.direction}, ${c.duration_sec} сек. ${rule.description || rule.name}`
        }));

        const { error: insError } = await supabase
            .from('okk_violations')
            .upsert(records, { onConflict: 'rule_code, call_id' });

        if (insError) console.error(`Error saving violations for ${rule.code}:`, insError);
        return violations.length;
    }
    return 0;
}
