import { supabase } from '@/utils/supabase';
import { analyzeTranscript, analyzeText } from './semantic';
import { evaluateChecklist } from './quality-control';
import { sendTelegramNotification } from './telegram';

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
    entity_type: 'call' | 'order' | 'event' | 'stage';
    logic: RuleLogic;
    params: Record<string, any>;
    severity: string;
    rule_type?: 'sql' | 'semantic';
    semantic_prompt?: string;
    name: string;
    description: string;
    condition_sql?: string; // Legacy support
    points?: number;
    notify_telegram?: boolean; // New field
    checklist?: any; // JSON structure for Quality Control
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
        // STATE-BASED: Fetch current orders (NO JOIN here as FK is missing)
        query = supabase.from('orders').select('*');
    } else {
        query = supabase.from('raw_order_events').select('*');
    }

    // Apply filters specialized by entity type
    if (rule.entity_type === 'call') {
        query = query.gte('started_at', startDate).lte('started_at', endDate);
    } else if (rule.entity_type === 'order') {
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
            if (target) query = query.eq('event_type', 'status_changed');
        }
    }

    const { data: items, error } = await query;
    if (error) {
        if (trace) trace.push(`[RuleEngine] [${rule.code}] DB ERROR: ${error.message}`);
        console.error(`[RuleEngine] [${rule.code}] Query error:`, error);
    }
    if (!items || items.length === 0) return dryRun ? [] : 0;

    if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidates Found: ${items.length}`);

    // FETCH METRICS MANUALLY if needed
    let metricsMap = new Map();
    if (rule.entity_type !== 'call') {
        const orderIds = items.map(i => i.retailcrm_order_id || i.id);
        const { data: metricsData } = await supabase
            .from('order_metrics')
            .select('retailcrm_order_id, current_status, manager_id, full_order_context')
            .in('retailcrm_order_id', orderIds);

        if (metricsData) {
            metricsData.forEach(m => metricsMap.set(m.retailcrm_order_id, m));
        }
    }

    const violations: any[] = [];

    // 2. Evaluate each candidate
    for (const item of items) {
        const orderId = rule.entity_type === 'call' ? item.call_order_matches?.[0]?.order_id : (item.retailcrm_order_id || item.id);
        const metrics = rule.entity_type === 'call'
            ? item.call_order_matches?.[0]?.orders
            : metricsMap.get(orderId);

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

        // --- NEW: Stage Audit Logic (Multi-Interaction) ---
        if (rule.entity_type === 'stage') {
            // If triggered by status_change, we usually want to audit the status we just LEFT
            let statusToAudit = item.status;
            let exitTime = context.occurredAt;

            if (item.event_type === 'status_changed' || item.event_type === 'status') {
                const oldVal = item.raw_payload?.oldValue;
                statusToAudit = (typeof oldVal === 'object' && oldVal !== null) ? oldVal.code : oldVal;
                if (!statusToAudit) {
                    if (trace) trace.push(`[RuleEngine] [${rule.code}] Stage Audit: Could not determine previous status. Skipping.`);
                    continue;
                }
            }

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Stage Audit for Order ${orderId}, Status: ${statusToAudit}. Collecting evidence...`);

            const { collectStageEvidence } = await import('./stage-collector');
            const { evaluateStageChecklist } = await import('./quality-control');

            // Find when we ENTERED the status we just left
            const { data: entryEvent } = await supabase
                .from('raw_order_events')
                .select('occurred_at')
                .eq('retailcrm_order_id', orderId)
                .or(`event_type.eq.status,event_type.eq.status_changed`)
                .filter('raw_payload->newValue->>code', 'eq', statusToAudit)
                .lt('occurred_at', exitTime)
                .order('occurred_at', { ascending: false })
                .limit(1)
                .single();

            const start = entryEvent?.occurred_at || item.created_at_crm || item.created_at;

            const evidence = await collectStageEvidence(orderId, statusToAudit, start, exitTime);

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Collected ${evidence.interactions.length} interactions for stage ${statusToAudit}.`);

            if (rule.checklist && rule.checklist.length > 0) {
                const qcResult = await evaluateStageChecklist(evidence, rule.checklist);

                if (qcResult.totalScore < 100) {
                    violations.push({
                        rule_code: rule.code,
                        order_id: context.orderId,
                        manager_id: context.managerId,
                        violation_time: context.occurredAt,
                        severity: rule.severity,
                        points: rule.points || (100 - qcResult.totalScore),
                        details: `${qcResult.summary} (Оценка: ${qcResult.totalScore}/100)`,
                        checklist_result: qcResult
                    });
                }
                continue;
            }
        }

        // --- NEW: Checklist Evaluation Logic (Atomic/Call-based) ---
        if (rule.checklist && rule.checklist.length > 0) {
            const transcript = item.transcript || '';
            if (!transcript || transcript.length < 50) {
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Transcript too short or missing.`);
                console.log(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Transcript too short or missing.`);
                continue; // Cannot evaluate
            }

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Evaluating Checklist...`);

            const qcResult = await evaluateChecklist(transcript, rule.checklist);

            // If score < 100, record deviation (or if specifically violated)
            if (qcResult.totalScore < 100) {
                violations.push({
                    rule_code: rule.code,
                    order_id: context.orderId,
                    manager_id: context.managerId,
                    violation_time: context.occurredAt,
                    severity: rule.severity,
                    points: (100 - qcResult.totalScore), // Dynamic points based on loss? Or rule.points?
                    // Let's use rule.points if defined, otherwise the mismatch.
                    // Actually, maybe rule.points is "Points Per Rule".
                    // Let's stick to rule.points for now if available.
                    call_id: rule.entity_type === 'call' ? item.event_id : null,
                    details: `${qcResult.summary} (Оценка: ${qcResult.totalScore}/100)`,
                    evidence_text: null, // No single quote, it's a full report
                    checklist_result: qcResult
                });
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Checklist Score ${qcResult.totalScore}/100. Recorded violation.`);
            } else {
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Perfect Score 100/100.`);
            }
            continue; // Skip standard logic
        }
        // ---------------------------------------

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
                points: rule.points || 10,
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
            else {
                // Send Telegram Notification ONLY if enabled in rule
                if (violations.length > 0 && rule.notify_telegram) {
                    try {
                        const emoji = rule.severity === 'critical' ? '🆘' : rule.severity === 'high' ? '🔴' : '⚠️';

                        for (const v of violations) {
                            const details = v.details.length > 200 ? v.details.substring(0, 200) + '...' : v.details;
                            const points = v.points ? `(${v.points} баллов)` : '';

                            // Custom message for Checklist (if result present)
                            let extraInfo = '';
                            if (v.checklist_result) {
                                // Add breakdown of missed items?
                                // Let's keep it simple for now as requested.
                            }

                            const message = `
<b>${emoji} Новое нарушение ${points}</b>
<b>Правило:</b> ${rule.name}
<b>Заказ:</b> <a href="https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit">#${v.order_id}</a>
<b>Менеджер:</b> ${v.manager_id}

${details}
                            `.trim();

                            // Fire and forget to not block execution
                            sendTelegramNotification(message).catch(e => console.error('[RuleEngine] Async notify error:', e));
                        }
                    } catch (notifyError) {
                        console.error('[RuleEngine] Failed to prepare notification:', notifyError);
                    }
                }
            }
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

