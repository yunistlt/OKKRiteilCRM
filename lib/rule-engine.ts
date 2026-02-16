import { supabase } from '@/utils/supabase';
import { analyzeTranscript, analyzeText } from './semantic';

export interface RuleLogicBlock {
    block: string;
    params: Record<string, any>;
}

export interface RuleLogic {
    trigger: RuleLogicBlock | null;
    conditions: RuleLogicBlock[];
}

export interface Rule {
    code: string;
    entity_type: 'call' | 'order' | 'event';
    logic: RuleLogic;
    params: Record<string, any>;
    severity: string;
    rule_type?: 'sql' | 'semantic';
    semantic_prompt?: string;
    name: string;
    description: string;
    condition_sql?: string; // Legacy support
}

/**
 * Execute all active rules against a time range.
 */
export async function runRuleEngine(startDate: string, endDate: string, targetRuleId?: string, dryRun = false, adHocRule?: any, trace?: string[]) {
    if (trace) trace.push(`[RuleEngine V2] Range: ${startDate} to ${endDate}`);

    const statusesPromise = supabase.from('statuses').select('code, name');

    // If adHocRule is provided, we use it instead of fetching from DB
    let rules: any[] = [];
    if (adHocRule) {
        rules = [adHocRule];
    } else {
        let rulesQuery = supabase.from('okk_rules').select('*').eq('is_active', true);
        if (targetRuleId) {
            rulesQuery = rulesQuery.eq('code', targetRuleId);
        }
        const { data: dbRules, error: rulesError } = await rulesQuery;
        if (rulesError || !dbRules) {
            console.error('[RuleEngine] Failed to fetch rules:', rulesError);
            return dryRun ? [] : 0;
        }
        rules = dbRules;
    }

    const { data: statuses } = await statusesPromise;
    const statusMap = new Map((statuses || []).map(s => [s.name.toLowerCase(), s.code]));
    if (trace && rules.length > 0) trace.push(`[RuleEngine] Processing ${rules.length} rules.`);

    let totalViolationsCount = 0;
    const allViolations: any[] = [];

    for (const rule of rules) {
        try {
            if (rule.logic) {
                const results = await executeBlockRule(rule, startDate, endDate, statusMap, dryRun, trace);
                if (dryRun) {
                    allViolations.push(...(results as any[]));
                } else {
                    totalViolationsCount += results as number;
                }
            }
        } catch (e) {
            if (trace) trace.push(`[RuleEngine] CRITICAL ERROR for ${rule.code}: ${e}`);
            console.error(`[RuleEngine] Error executing rule ${rule.code}:`, e);
        }
    }
    return dryRun ? allViolations : totalViolationsCount;
}

/**
 * NEW: Executes a rule based on Structured Logic Blocks
 */
async function executeBlockRule(rule: any, startDate: string, endDate: string, statusMap?: Map<string, string>, dryRun = false, trace?: string[]): Promise<number | any[]> {
    const logic = rule.logic as RuleLogic;
    if (!logic) return dryRun ? [] : 0;

    if (trace) trace.push(`[RuleEngine] [${rule.code}] Executing Entity: ${rule.entity_type}`);

    // 1. Fetch Candidates based on Trigger
    let query;
    if (rule.entity_type === 'call') {
        query = supabase.from('raw_telphin_calls').select('*, call_order_matches(order_id: retailcrm_order_id, orders(manager_id))');
    } else if (rule.entity_type === 'order') {
        // STATE-BASED: Fetch current orders
        // Use simpler select if joined metrics cause issues
        query = supabase.from('orders').select('*, order_metrics(current_status, manager_id, full_order_context)');
    } else {
        query = supabase.from('raw_order_events').select('*, order_metrics(current_status, manager_id, full_order_context)');
    }

    // Apply filters specialized by entity type
    if (rule.entity_type === 'call') {
        query = query.gte('started_at', startDate).lte('started_at', endDate);
    } else if (rule.entity_type === 'order') {
        // For orders, we filter by their current status if trigger is "status_change"
        if (logic.trigger && logic.trigger.block === 'status_change') {
            const target = logic.trigger.params.target_status;
            if (target) {
                query = query.eq('status', target);
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Filter: status = ${target}`);
            }
        }
    } else {
        query = query.gte('occurred_at', startDate).lte('occurred_at', endDate);
        if (logic.trigger && logic.trigger.block === 'status_change') {
            const target = logic.trigger.params.target_status;
            if (target) {
                query = query.eq('event_type', 'status_changed');
            }
        }
    }

    const { data: items, error } = await query;
    if (error) {
        if (trace) trace.push(`[RuleEngine] [${rule.code}] DB ERROR: ${error.message}`);
        console.error(`[RuleEngine] [${rule.code}] Query error:`, error);
    }
    if (!items) return dryRun ? [] : 0;

    if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidates Found: ${items.length}`);

    const violations: any[] = [];

    // 2. Evaluate each candidate
    for (const item of items) {
        const orderId = rule.entity_type === 'call' ? item.call_order_matches?.[0]?.order_id : (item.retailcrm_order_id || item.id);
        const metrics = rule.entity_type === 'call'
            ? item.call_order_matches?.[0]?.orders
            : (rule.entity_type === 'order' ? item.order_metrics : (Array.isArray(item.order_metrics) ? item.order_metrics[0] : item.order_metrics));

        let occurredAt = rule.entity_type === 'call' ? item.started_at : (item.raw_payload?._sync_metadata?.order_statusUpdatedAt || item.occurred_at);

        // SPECIAL LOGIC FOR ORDERS: Find when they ENTERED this state
        if (rule.entity_type === 'order') {
            const currentStatus = item.status;

            // Find latest event where status WAS changed to this one
            const { data: transitionEvent } = await supabase
                .from('raw_order_events')
                .select('occurred_at')
                .eq('retailcrm_order_id', orderId)
                .or(`event_type.eq.status,event_type.eq.status_changed`)
                .filter('raw_payload->newValue->>code', 'eq', currentStatus)
                .order('occurred_at', { ascending: false })
                .limit(1)
                .single();

            if (transitionEvent) {
                occurredAt = transitionEvent.occurred_at;
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Found transition event at ${occurredAt}`);
            } else {
                occurredAt = item.updated_at || item.created_at || item.created_at_crm || new Date().toISOString();
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: No transition event. Fallback occurredAt: ${occurredAt}`);
            }
        }

        const context = {
            item,
            metrics,
            orderId,
            managerId: metrics?.manager_id || item.manager_id,
            occurredAt: occurredAt
        };

        // A. Match Trigger
        if (logic.trigger) {
            const matchesTrigger = matchBlock(logic.trigger, context);
            const targetStatus = logic.trigger.params?.target_status;
            if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Trigger "${logic.trigger.block}" Match = ${matchesTrigger} (Status: "${item.status}", Expected: "${targetStatus}")`);
            if (!matchesTrigger) continue;
        }

        // B. Match All Conditions
        let allMatched = true;
        let semanticResult = null;

        for (const cond of logic.conditions) {
            let condMatch = false;
            if (cond.block === 'no_new_comments') {
                const { data: activity } = await supabase
                    .from('raw_order_events')
                    .select('event_id, event_type, raw_payload, occurred_at')
                    .eq('retailcrm_order_id', context.orderId)
                    .gt('occurred_at', context.occurredAt)
                    .limit(10);

                const hasRealActivity = (activity || []).some(ev => {
                    const type = String(ev.event_type);
                    const field = String(ev.raw_payload?.field || '');
                    return type.includes('comment') || type.includes('message') || field === 'manager_comment';
                });

                condMatch = !hasRealActivity;
                if (!condMatch && trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Found activity after ${context.occurredAt}`);
            } else if (cond.block === 'semantic_check') {
                const text = metrics?.full_order_context?.manager_comment || item.transcript || '';
                if (!text) {
                    condMatch = false;
                } else {
                    const res = await analyzeText(text, cond.params.prompt || rule.description, 'Context');
                    if (res.is_violation) {
                        semanticResult = res;
                        condMatch = true;
                    }
                }
            } else {
                condMatch = matchBlock(cond, context);
            }

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Condition "${cond.block}" Match = ${condMatch}`);
            if (!condMatch) {
                allMatched = false;
                break;
            }
        }

        if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Final Match = ${allMatched}`);
        if (allMatched) {
            violations.push({
                rule_code: rule.code,
                order_id: context.orderId,
                manager_id: context.managerId,
                violation_time: context.occurredAt,
                severity: rule.severity,
                call_id: rule.entity_type === 'call' ? item.event_id : null,
                details: semanticResult ? semanticResult.reasoning : `${rule.name}: Нарушение зафиксировано.`,
                evidence_text: semanticResult ? semanticResult.evidence : null
            });
        }
    }

    if (violations.length > 0) {
        if (!dryRun) {
            const { error: insError } = await supabase
                .from('okk_violations')
                .upsert(violations, { onConflict: 'rule_code, order_id, violation_time, call_id' });

            if (insError) console.error(`[RuleEngine] Upsert Error for ${rule.code}:`, insError);
        }
        return dryRun ? violations : violations.length;
    }

    return dryRun ? [] : 0;
}

/**
 * DISPATCHER: Simple Block Logic (Sync/Structural)
 */
function matchBlock(block: RuleLogicBlock, context: any): boolean {
    const { item, metrics } = context;

    switch (block.block) {
        case 'status_change':
            const targetStatus = block.params.target_status;
            const direction = block.params.direction || 'to';

            // For order entity, 'item' is an order row. For events, it's an event row.
            // Support both structures
            const rawVal = item.raw_payload?.newValue || item.raw_payload?.status || item.status;
            const actualStatus = (typeof rawVal === 'object' && rawVal !== null) ? rawVal.code : rawVal;

            if (direction === 'to') {
                return actualStatus === targetStatus;
            } else if (direction === 'from') {
                const oldRaw = item.raw_payload?.oldValue;
                // For orders, it's hard to know 'from' without history, 
                // but we assume if we are checking an event, it has oldValue.
                const oldStatus = (typeof oldRaw === 'object' && oldRaw !== null) ? oldRaw.code : oldRaw;
                return oldStatus === targetStatus;
            }
            return false;

        case 'field_empty':
            const path = block.params.field_path;
            const contextData = metrics?.full_order_context || {};
            const val = contextData[path];
            return (val === undefined || val === null || String(val).trim() === '' || String(val) === 'null');

        case 'time_elapsed':
            const hours = block.params.hours || 0;
            const eventTime = new Date(context.occurredAt).getTime();
            return (Date.now() - eventTime) > (hours * 60 * 60 * 1000);

        case 'call_exists':
            // Logic handled in a batch way usually, but here we check existence in history if possible.
            // Since this is a check block, it might need a pre-cached call list.
            // For now, simplicity: return true if we don't have call data. 
            // Better to implement this with a subquery or pre-fetching.
            return true;

        default:
            return false;
    }
}
