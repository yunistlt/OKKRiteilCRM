// ОТВЕТСТВЕННЫЙ: МАКСИМ (Аудитор) — Движок правил: автоматическая проверка всех условий и триггеров.
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
export async function runRuleEngine(startDate: string, endDate: string, targetRuleId?: string, dryRun = false, adHocRule?: any, trace?: string[], targetOrderId?: number | string) {
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
    const statusMap = new Map<string, string>((statuses || []).map((s: any) => [s.name.toLowerCase(), s.code]));
    if (trace && rules.length > 0) trace.push(`[RuleEngine] Processing ${rules.length} rules.`);

    const { logAgentActivity } = await import('./agent-logger');
    await logAgentActivity('maxim', 'working', `Проверяю соблюдение ${rules.length} правил ОКК...`);

    let totalViolationsCount = 0;
    const allViolations: any[] = [];

    for (const rule of rules) {
        try {
            if (rule.logic) {
                const results = await executeBlockRule(rule, startDate, endDate, statusMap, dryRun, trace, targetOrderId);
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

    await logAgentActivity('maxim', 'idle', 'Проверка правил завершена. Нарушений не обнаружено.');

    return dryRun ? allViolations : totalViolationsCount;
}

/**
 * NEW: Executes a rule based on Structured Logic Blocks
 */
async function executeBlockRule(rule: any, startDate: string, endDate: string, statusMap?: Map<string, string>, dryRun = false, trace?: string[], targetOrderId?: number | string): Promise<number | any[]> {
    const logic = rule.logic as RuleLogic;
    if (!logic) return dryRun ? [] : 0;

    if (trace) trace.push(`[RuleEngine] [${rule.code}] Executing Entity: ${rule.entity_type}`);

    // 1. Fetch Candidates based on Trigger
    let query;
    const SYNTHETIC_ORDER_ID_MIN = 99900000; // Synthetic test orders use IDs 99900000+
    if (rule.entity_type === 'call') {
        // Use !inner to ensure we only get calls that actually have an order match,
        // which drastically reduces data transfer and fixes 504 timeouts when filtering by targetOrderId.
        query = supabase.from('raw_telphin_calls').select('*, call_order_matches!inner(order_id: retailcrm_order_id, orders(manager_id))');
    } else if (rule.entity_type === 'order') {
        // STATE-BASED: Fetch current orders (NO JOIN here as FK is missing)
        // Exclude synthetic test orders (ID >= 99900000) to prevent test pollution in production cron runs.
        // Skip this filter if targetOrderId is set (we're in test mode targeting a specific order).
        query = targetOrderId
            ? supabase.from('orders').select('*')
            : supabase.from('orders').select('*').lt('order_id', SYNTHETIC_ORDER_ID_MIN);
    } else {
        // Also exclude synthetic events for non-targeted runs
        query = targetOrderId
            ? supabase.from('raw_order_events').select('*')
            : supabase.from('raw_order_events').select('*').lt('retailcrm_order_id', SYNTHETIC_ORDER_ID_MIN);
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

    // Apply strict filter if testing a specific order
    if (targetOrderId) {
        if (rule.entity_type === 'call') {
            // Filter via call_order_matches
            query = query.filter('call_order_matches.retailcrm_order_id', 'eq', targetOrderId);
        } else if (rule.entity_type === 'order') {
            query = query.eq('id', targetOrderId);
        } else {
            query = query.eq('retailcrm_order_id', targetOrderId);
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
        const orderIds = items.map((i: any) => i.retailcrm_order_id || i.id);
        const { data: metricsData } = await supabase
            .from('order_metrics')
            .select('retailcrm_order_id, current_status, manager_id, full_order_context')
            .in('retailcrm_order_id', orderIds);

        if (metricsData) {
            metricsData.forEach((m: any) => metricsMap.set(m.retailcrm_order_id, m));
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
            // OPTIMIZATION: In a real production scenario with high volume, 
            // we should pre-fetch these transitions in a batch before the loop.
            // For now, keeping it but flagging as potential bottleneck.
            const currentStatus = item.status;
            occurredAt = item.updated_at || item.created_at || item.created_at_crm || new Date().toISOString();
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

                // NEW: Only audit if this rule is meant for this specific status
                if (rule.params?.stage_status && rule.params.stage_status !== 'any' && statusToAudit !== rule.params.stage_status) {
                    if (trace) trace.push(`[RuleEngine] [${rule.code}] Stage Audit: Status ${statusToAudit} does not match rule param ${rule.params.stage_status}. Skipping.`);
                    continue;
                }
            }

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Stage Audit for Order ${orderId}, Status: ${statusToAudit}. Collecting evidence...`);

            // OPTIMIZATION: Moved dynamic imports outside if possible or keep for tree-shaking but ensure they are used efficiently
            const { collectStageEvidence } = await import('./stage-collector');
            const { evaluateStageChecklist } = await import('./quality-control');

            // NEW: Batch find entry events for all candidates to avoid N+1
            // (Actually, stage-collector already does some fetching, but we can pass entry points)

            const start = item.created_at_crm || item.created_at;
            const evidence = await collectStageEvidence(orderId, statusToAudit, start, exitTime);

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Collected ${evidence.interactions.length} interactions for stage ${statusToAudit}.`);

            if (rule.checklist && rule.checklist.length > 0) {
                const qcResult = await evaluateStageChecklist(evidence, rule.checklist);
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Stage QC Score: ${qcResult.totalScore}/100. Summary: ${qcResult.summary}`);

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
            let transcript = item.transcript || '';

            // If it's an order/event based rule, find the transcript from associated calls
            if (!transcript && (rule.entity_type === 'order' || rule.entity_type === 'event')) {
                const { data: callData } = await supabase
                    .from('call_order_matches')
                    .select('raw_telphin_calls(transcript)')
                    .eq('retailcrm_order_id', orderId)
                    .order('telphin_call_id', { ascending: false })
                    .limit(1)
                    .single();

                transcript = (callData as any)?.raw_telphin_calls?.transcript || '';
            }

            if (!transcript || transcript.length < 50) {
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Transcript too short or missing.`);
                continue; // Cannot evaluate
            }

            if (trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Evaluating Checklist...`);

            const qcResult = await evaluateChecklist(transcript, rule.checklist);
            if (trace) trace.push(`[RuleEngine] [${rule.code}] Checklist Score: ${qcResult.totalScore}/100. Summary: ${qcResult.summary}`);

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

                const hasRealActivity = (activity || []).some((ev: any) => {
                    const type = String(ev.event_type);
                    const field = String(ev.raw_payload?.field || '');
                    return type.includes('comment') || type.includes('message') || field === 'manager_comment';
                });

                condMatch = !hasRealActivity;
                if (!condMatch && trace) trace.push(`[RuleEngine] [${rule.code}] Candidate ${orderId}: Found activity after ${context.occurredAt}`);
            } else if (cond.block === 'semantic_check') {
                const text = metrics?.full_order_context?.manager_comment || item.transcript || '';
                // Even if text is empty, the AI might consider it a violation (e.g., "Check if contacts were left").
                // If we skip when empty, we never catch missing data violations.
                const evalText = text ? text : '--- Текст отсутствует (нет комментария менеджера или расшифровки) ---';
                const res = await analyzeText(evalText, cond.params.prompt || rule.description, 'Context');
                if (trace) trace.push(`[RuleEngine] [${rule.code}] Semantic Result: ${res.is_violation ? 'VIOLATION' : 'PASS'}. Reasoning: ${res.reasoning}`);
                if (res.is_violation) {
                    semanticResult = res;
                    condMatch = true;
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
            // Fix: remove call_id from onConflict definition if it's not unique enough, 
            // or just rely on rule_code, order_id, violation_time.
            // Using a simple insert for testing, or standard unique constraint.
            // We'll use a standard insert as Upsert requires exact unique constraints on those columns in Supabase.
            const { error: insError } = await supabase
                .from('okk_violations')
                .insert(violations);

            if (insError) {
                if (insError.code === '23505') {
                    // 23505 = unique_violation, meaning we already recorded this violation
                    if (trace) trace.push(`[RuleEngine] Violation already exists for ${rule.code} (Ignored).`);
                } else {
                    console.error(`[RuleEngine] Insert Error for ${rule.code}:`, insError);
                }
            } else {
                // Send Telegram Notification ONLY if enabled in rule
                if (rule.notify_telegram) {
                    try {
                        const { generateHumanNotification } = await import('./semantic');

                        // Fetch manager names
                        const managerIds = Array.from(new Set(violations.map((v: any) => v.manager_id).filter(Boolean)));
                        const managerMap = new Map();
                        if (managerIds.length > 0) {
                            const { data: managers } = await supabase.from('managers').select('id, first_name').in('id', managerIds);
                            if (managers) managers.forEach((m: any) => managerMap.set(m.id, m.first_name));
                        }

                        // We only process up to 30 notifications per rule run to prevent Vercel 300s timeout
                        const notifyViolations = violations.slice(0, 30);
                        if (violations.length > 30) {
                            console.warn(`[RuleEngine] Truncated notifications from ${violations.length} to 30 to prevent timeout.`);
                        }

                        // Await the messages sequentially to respect rate limits and keep Vercel alive
                        for (const v of notifyViolations) {
                            const details = v.details.length > 200 ? v.details.substring(0, 200) + '...' : v.details;
                            const managerName = managerMap.get(v.manager_id) || '';

                            const aiMessage = await generateHumanNotification(
                                managerName,
                                v.order_id.toString(),
                                rule.name,
                                details,
                                v.points || 10
                            );

                            await sendTelegramNotification(aiMessage);

                            // Artificial delay of 1.5 seconds to bypass Telegram Rate-Limit (max 1 msg/sec/chat)
                            await new Promise(r => setTimeout(r, 1500));
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

        case 'new_call_transcribed':
            // If the entity is a call, it matches by definition of being processed.
            // If the entity is an order event, check if the event type matches.
            if (item.event_type === 'new_call_transcribed') return true;
            // If it's a direct call entity test
            if (item.telphin_call_id) return true;
            return false;

        default:
            return false;
    }
}

