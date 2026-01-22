
import { supabase } from '../utils/supabase';

async function totalPurge() {
    console.log('--- STARTING TOTAL PURGE ---');

    // 1. Delete all violations
    console.log('Purging okk_violations...');
    const { error: violError } = await supabase.from('okk_violations').delete().neq('rule_code', 'VOID_RULE_DO_NOT_DELETE');
    if (violError) {
        console.error('Error purging violations:', violError);
    } else {
        console.log('Violations purged.');
    }

    // 2. Delete all rules
    console.log('Purging okk_rules...');
    const { error: rulesError } = await supabase.from('okk_rules').delete().neq('code', 'VOID_RULE_DO_NOT_DELETE');
    if (rulesError) {
        console.error('Error purging rules:', rulesError);
    } else {
        console.log('Rules purged.');
    }

    // 3. Clear rule test logs
    console.log('Purging okk_rule_test_logs...');
    const { error: testError } = await supabase.from('okk_rule_test_logs').delete().neq('rule_code', 'VOID_RULE_DO_NOT_DELETE');
    if (testError) {
        console.error('Error purging test logs:', testError);
    } else {
        console.log('Test logs purged.');
    }

    console.log('--- PURGE COMPLETED ---');
}

totalPurge();
