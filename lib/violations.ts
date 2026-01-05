import { supabase } from '@/utils/supabase';

export type ViolationType =
    | 'short_call'
    | 'missed_call'
    | 'fake_qualification'
    | 'illegal_cancel_from_new'
    | 'no_comment_on_status_change'
    | 'timer_reset_attempt'
    | 'critical_status_overdue'
    | 'no_call_before_qualification'
    | 'call_impersonation'
    | 'high_call_imitation_rate'
    | 'order_dragging'
    | 'order_exit_without_result';

export interface Violation {
    call_id?: string;
    manager_id: string | number | null;
    manager_name?: string;
    order_id: number | null;
    violation_type: ViolationType;
    severity: 'low' | 'medium' | 'high';
    details: string;
    created_at: string;
}

const NEW_STATUSES = ['novyi', 'novaya-zayavka', 'novaia-zaiavka-vto'];
const QUALIFIED_STATUS = 'zayavka-otkalifitsirovana';
const CANCEL_STATUSES = ['sdelka-provalena-ukazat-prichiny-provala-tseh-uspeh', 'ne-vyigrali-tender', 'tender-otkaz'];

export async function detectViolations(startDate: string, endDate: string) {
    const violations: Violation[] = [];

    // 1. Fetch metadata
    const { data: managersRaw } = await supabase.from('managers').select('id, first_name, last_name');
    const managerNames: Record<number, string> = {};
    (managersRaw || []).forEach(m => {
        managerNames[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    });

    const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingCodes = new Set((workingSettings || []).map(s => s.code));

    // 1b. Fetch Controlled Managers
    const { data: controlledRaw } = await supabase.from('manager_settings').select('id').eq('is_controlled', true);
    const controlledIds = new Set((controlledRaw || []).map(m => m.id as number));

    // If no managers are controlled yet, we might want to show all to avoid "empty" state confusion, 
    // BUT the user explicitly asked for a control list, so we follow strictly.
    const isControlActive = controlledIds.size > 0;

    // 2. Fetch all calls in range with Order Match and Order Manager
    // 1c. Fetch Active Rules
    const { data: rules } = await supabase
        .from('okk_rules')
        .select('*')
        .eq('is_active', true);

    const activeRules = new Map((rules || []).map(r => [r.code, r]));

    // 2. Fetch all calls in range with Order Match and Order Manager
    const { data: calls, error: fetchError } = await supabase
        .from('raw_telphin_calls')
        .select(`
            id: telphin_call_id,
            duration: duration_sec,
            timestamp: started_at,
            flow: direction,
            raw_payload,
            call_order_matches(
                order_id: retailcrm_order_id,
                orders(status, manager_id)
            )
        `)
        .gte('started_at', startDate)
        .lte('started_at', endDate);

    if (fetchError) {
        throw new Error(`Violations fetch error: ${fetchError.message}`);
    }

    // 3. Fetch all history events in range
    const { data: history } = await supabase
        .from('order_history')
        .select('*')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true });

    // 4. Fetch active orders for SLA checks
    const { data: activeOrders } = await supabase
        .from('orders')
        .select('id, number, status, created_at, updated_at, manager_id')
        .in('status', Array.from(workingCodes));

    const callData = calls || [];
    const historyData = history || [];

    // Group history by order
    const historyByOrder: Record<number, any[]> = {};
    historyData.forEach(h => {
        if (!historyByOrder[h.order_id]) historyByOrder[h.order_id] = [];
        historyByOrder[h.order_id].push(h);
    });

    // --- CALL-BASED RULES (NOW DYNAMIC) ---
    for (const call of callData) {
        // Map raw_payload fields
        const isAnsweringMachine = (call.raw_payload as any)?.is_answering_machine === true;
        const match = call.call_order_matches?.[0]; // Relation name changed

        // DEBUG PROBE
        if (call.id === '349957-CD02BDDC732441F49C7531F68EFD87FD') {
            violations.push({
                call_id: call.id,
                manager_id: 10, // Force match
                order_id: null,
                violation_type: 'short_call',
                severity: 'low',
                details: `DEBUG PROBE: Match: ${JSON.stringify(call.call_order_matches)}, Duration: ${call.duration}, ManagerID: ${(match as any)?.orders?.manager_id}`,
                created_at: call.timestamp
            });
        }

        if (!match) continue; // RULE 1: Skip if no matching order

        const orderId = match.order_id;
        const managerId = (match as any).orders?.manager_id ? Number((match as any).orders.manager_id) : null;
        const duration = call.duration || 0;

        const amdRule = activeRules.get('answering_machine_dialog');
        if (amdRule) {
            const threshold = amdRule.parameters?.threshold_sec || 15;
            if (duration > threshold && isAnsweringMachine) {
                violations.push({
                    call_id: call.id,
                    manager_id: managerId,
                    order_id: orderId,
                    violation_type: 'call_impersonation', // Mapping to existing UI type or generic
                    severity: amdRule.severity as any || 'high',
                    details: `Разговор с автоответчиком: ${duration} сек > ${threshold} сек (Имитация диалога)`,
                    created_at: call.timestamp
                });
            }
        }

        // RULE: Call Impersonation / Fake Dialing (Dynamic: call_impersonation)
        const impersonationRule = activeRules.get('call_impersonation');
        if (impersonationRule) {
            const threshold = impersonationRule.parameters?.threshold_sec || 5;
            if (duration > 0 && duration < threshold) {
                violations.push({
                    call_id: call.id,
                    manager_id: managerId,
                    order_id: orderId,
                    violation_type: 'call_impersonation',
                    severity: impersonationRule.severity as any || 'high',
                    details: `Имитация звонка: длительность ${duration} сек < ${threshold} сек`,
                    created_at: call.timestamp
                });
            }
        }

        // RULE: Short Call (Dynamic: short_call)
        const shortCallRule = activeRules.get('short_call');
        if (shortCallRule) {
            const threshold = shortCallRule.parameters?.threshold_sec || 20;
            const minDuration = 5; // Fixed min to distinguish from impersonation
            if (duration >= minDuration && duration < threshold) {
                violations.push({
                    call_id: call.id,
                    manager_id: managerId,
                    order_id: orderId,
                    violation_type: 'short_call',
                    severity: shortCallRule.severity as any || 'medium',
                    details: `Короткий звонок: ${duration} сек < ${threshold} сек`,
                    created_at: call.timestamp
                });
            }
        }

        // RULE: Missed Call (Dynamic: missed_incoming)
        const missedCallRule = activeRules.get('missed_incoming');
        if (missedCallRule) {
            if (call.flow === 'incoming' && duration === 0) {
                violations.push({
                    call_id: call.id,
                    manager_id: managerId,
                    order_id: orderId,
                    violation_type: 'missed_call',
                    severity: missedCallRule.severity as any || 'high',
                    details: `Пропущенный входящий вызов`,
                    created_at: call.timestamp
                });
            }
        }
    }

    // --- HISTORY-BASED RULES ---
    for (const orderIdStr in historyByOrder) {
        const orderId = parseInt(orderIdStr);
        const events = historyByOrder[orderId];

        for (let i = 0; i < events.length; i++) {
            const current = events[i];

            // RULE 3: NO_COMMENT_ON_STATUS_CHANGE
            if (current.field_name === 'status') {
                const hasComment = events.some(e =>
                    e.field_name === 'comment' &&
                    Math.abs(new Date(e.created_at).getTime() - new Date(current.created_at).getTime()) < 10000
                );

                if (!hasComment) {
                    violations.push({
                        manager_id: current.manager_id,
                        order_id: orderId,
                        violation_type: 'no_comment_on_status_change',
                        severity: 'low',
                        details: `Смена статуса на "${current.new_value}" без комментария`,
                        created_at: current.created_at
                    });
                }

                // RULE 1: FAKE_QUALIFICATION
                if (current.new_value === QUALIFIED_STATUS && NEW_STATUSES.includes(current.old_value)) {
                    // Check if there was a call > 20s for this order (in ALL callData, not just current range)
                    // Heuristic: for history analysis, we might need a broader call sync.
                    const orderCalls = callData.filter(c => c.call_order_matches?.[0]?.order_id === orderId);
                    const hasValidCall = orderCalls.some(c =>
                        (c.duration || 0) > 20 &&
                        (c.raw_payload as any)?.is_answering_machine !== true && // Must NOT be an AM
                        new Date(c.timestamp).getTime() < new Date(current.created_at).getTime()
                    );

                    if (!hasValidCall) {
                        violations.push({
                            manager_id: current.manager_id,
                            order_id: orderId,
                            violation_type: 'fake_qualification',
                            severity: 'high',
                            details: `Квалификация без реального контакта (звонка > 20с)`,
                            created_at: current.created_at
                        });
                    }
                }

                // RULE 6: NO_CALL_BEFORE_QUALIFICATION
                if (current.new_value === QUALIFIED_STATUS) {
                    const orderCalls = callData.filter(c => c.call_order_matches?.[0]?.order_id === orderId);
                    if (orderCalls.length === 0) {
                        violations.push({
                            manager_id: current.manager_id,
                            order_id: orderId,
                            violation_type: 'no_call_before_qualification',
                            severity: 'high',
                            details: `Квалификация вообще без звонков клиенту`,
                            created_at: current.created_at
                        });
                    }
                }

                // RULE 2: ILLEGAL_CANCEL_FROM_NEW
                if (CANCEL_STATUSES.includes(current.new_value) && NEW_STATUSES.includes(current.old_value)) {
                    violations.push({
                        manager_id: current.manager_id,
                        order_id: orderId,
                        violation_type: 'illegal_cancel_from_new',
                        severity: 'medium',
                        details: `Отмена заказа напрямую из статуса "Новый"`,
                        created_at: current.created_at
                    });
                }

                // RULE 10: ORDER_EXIT_WITHOUT_RESULT
                if (CANCEL_STATUSES.includes(current.new_value)) {
                    const hasReason = events.some(e => e.field_name.includes('reason') || e.field_name.includes('cancel'));
                    if (!hasReason) {
                        violations.push({
                            manager_id: current.manager_id,
                            order_id: orderId,
                            violation_type: 'order_exit_without_result',
                            severity: 'medium',
                            details: `Перевод в отказ без указания причины`,
                            created_at: current.created_at
                        });
                    }
                }

                // RULE 4: TIMER_RESET_ATTEMPT
                if (i > 0) {
                    const prev = events[i - 1];
                    if (prev.field_name === 'status' && current.new_value === prev.old_value) {
                        const diff = new Date(current.created_at).getTime() - new Date(prev.created_at).getTime();
                        if (diff < 60000) {
                            violations.push({
                                manager_id: current.manager_id,
                                order_id: orderId,
                                violation_type: 'timer_reset_attempt',
                                severity: 'medium',
                                details: `Подозрение на сброс SLA: быстрый возврат статуса (${Math.round(diff / 1000)}с)`,
                                created_at: current.created_at
                            });
                        }
                    }
                }
            }
        }
    }

    // --- SLA / DRAGGING RULES ---
    const now = new Date().getTime();
    for (const order of (activeOrders || [])) {
        const createdAt = new Date(order.created_at).getTime();
        const updatedAt = new Date(order.updated_at).getTime();

        if (now - updatedAt > 30 * 24 * 60 * 60 * 1000) {
            violations.push({
                manager_id: order.manager_id,
                order_id: order.id,
                violation_type: 'order_dragging',
                severity: 'low',
                details: `Заказ "висит" без движения более 30 дней`,
                created_at: order.updated_at
            });
        }

        if (NEW_STATUSES.includes(order.status) && (now - createdAt > 4 * 60 * 60 * 1000)) {
            violations.push({
                manager_id: order.manager_id,
                order_id: order.id,
                violation_type: 'critical_status_overdue',
                severity: 'medium',
                details: `Превышен SLA ожидания в статусе "Новый" (> 4ч)`,
                created_at: order.created_at
            });
        }
    }

    // Map manager names and final cleanup
    const finalViolations = violations
        .filter(v => {
            // Filter out 'SYSTEM' events (manager_id is null)
            if (!v.manager_id) return false;

            // If control list is active, skip managers NOT in the list
            return !isControlActive || controlledIds.has(v.manager_id as number);
        })
        .map(v => ({
            ...v,
            manager_name: v.manager_id ? managerNames[v.manager_id as number] : 'Система'
        }));

    return finalViolations.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
