
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
export async function runRuleEngine(startDate: string, endDate: string) {
    console.log(`[RuleEngine] Running for range ${startDate} to ${endDate}`);

    // 1. Fetch Active Rules
    const { data: rules, error } = await supabase
        .from('okk_rules')
        .select('*')
        .eq('is_active', true);

    if (error || !rules) {
        console.error('[RuleEngine] Failed to fetch rules:', error);
        return;
    }

    console.log(`[RuleEngine] Found ${rules.length} active rules.`);

    // 2. Execute per entity type
    for (const rule of rules) {
        try {
            if (rule.entity_type === 'call') {
                await executeCallRule(rule, startDate, endDate);
            } else {
                console.log(`[RuleEngine] Skipping unsupported entity type: ${rule.entity_type} (${rule.code})`);
            }
        } catch (e) {
            console.error(`[RuleEngine] Error executing rule ${rule.code}:`, e);
        }
    }
}

async function executeCallRule(rule: any, startDate: string, endDate: string) {
    // 1. Construct Query
    // We need to inject parameters into the SQL or handle them via Supabase filter.
    // Supabase JS .filter() takes a column, operator, and value.
    // It doesn't support arbitrary SQL "WHERE condition".
    // ...Wait. Supabase JS client wraps PostgREST.
    // PostgREST doesn't support raw SQL injection in WHERE for security.

    // PROBLEM: Storing raw SQL `duration < (params->>'threshold')::int` in DB is great for SQL execution,
    // but hard to execute via supabase-js client side without an RPC function.

    // SOLUTION: Use an RPC function that takes the condition_sql? unsafe.
    // OR: Use strict filters in JSON? e.g. { "operator": "lt", "column": "duration", "value_param": "threshold" }
    // OR: Since we are running on Backend (or "Trusted Environment"), we can use the `postgres` driver ? 
    // No, we stick to supabase-js.

    // Workaround: We can't trust the client to parse random SQL. 
    // BUT! All our current rules are simple.
    // Let's implement a safe parser for our specific use case, OR use an RPC `execute_rule`.

    // RPC APPROACH is best. "execute_rule(rule_code, start_date, end_date)"
    // logic inside SQL function:
    //   SELECT * FROM raw_telphin_calls WHERE [condition injected] AND timestamp BETWEEN ...

    // BUT creating dynamic SQL functions requires a migration.
    // Let's try to simulate checking in code for now (fetch all, filter in memory) 
    // UNLESS the dataset is huge.
    // For "range", fetching all calls is acceptable (e.g. daily batch).
    // Let's fetch calls ONCE, then filter in code using Function constructor? Unsafe.
    // Using a simple evaluator.

    // Let's implement a pragmatic "Code Interpreter" for our rules.
    // We fetch calls, then we check:
    // if (evaluate(rule.condition_sql, call)) ...

    // Actually, `condition_sql` in the DB was defined as:
    // "duration >= 5 AND duration < (params->>'threshold_sec')::int"
    // This is purely Postgres syntax. It won't work in JS `eval`.

    // RE-DECISION: To make the "Rule Engine" real, it should run in the DB.
    // I will generate an RPC function `execute_call_rule` in the next migration.
    // This function will take a `where_clause` text and run it via `EXECUTE`.

    // For now (Step 1), I will implement logic here to PROVE it works, 
    // by manually "transpiling" the known SQL patterns to Supabase filters.

    // Updated for RAW Schema: raw_telphin_calls
    // Columns: event_id, duration_sec, started_at, is_answering_machine (missing in RAW, assuming false for now)

    let query = supabase
        .from('raw_telphin_calls')
        // We select 'event_id' as 'id', 'duration_sec' as 'duration', 'started_at' as 'timestamp' 
        // to match the code expectations locally, or just rename in logic.
        // Let's select properly.
        .select('event_id, duration_sec, started_at')
        .gte('started_at', startDate)
        .lte('started_at', endDate);

    const params = rule.parameters || {};

    // Mapping: 
    // duration -> duration_sec
    // timestamp -> started_at
    // id -> event_id

    // Manual transpiler for known patterns (Temporary Code Engine)
    // "duration < (params->>'threshold_sec')::int"  ->  .lt('duration', params.threshold_sec)
    // "flow = 'incoming'" -> .eq('flow', 'incoming')

    if (rule.code === 'short_call') {
        query = query
            .gte('duration_sec', 5)
            .lt('duration_sec', params.threshold_sec);
    }
    else if (rule.code === 'missed_incoming') {
        query = query
            .eq('direction', 'incoming')
            .eq('duration_sec', 0);
    }
    else if (rule.code === 'answering_machine_dialog') {
        // AMD not yet in RAW. Skipping for now to avoid errors.
        console.log('[RuleEngine] Skipping answering_machine_dialog (AMD data not ready)');
        return;
    }
    else if (rule.code === 'call_impersonation') {
        query = query
            .gt('duration_sec', 0)
            .lt('duration_sec', params.threshold_sec);
        // .neq('is_answering_machine', true); // Skipped
    }

    const { data: calls, error } = await query;

    if (error) {
        console.error(`Error fetching calls for ${rule.code}:`, error);
        return;
    }

    if (!calls || calls.length === 0) return;

    console.log(`[${rule.code}] Found ${calls.length} violations.`);

    // Insert Violations
    const violations = calls.map(c => ({
        rule_code: rule.code,
        call_id: c.event_id, // INT8
        violation_time: c.started_at,
        severity: rule.severity,
        details: `Detected by rule ${rule.name}`
    }));

    // Bulk upsert
    const { error: insError } = await supabase
        .from('okk_violations')
        .upsert(violations, { onConflict: 'rule_code, call_id' });

    if (insError) console.error(`Error saving violations for ${rule.code}:`, insError);
}
