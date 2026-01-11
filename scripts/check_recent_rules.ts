
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkRecentRules() {
    console.log('Checking for recently created rules...');

    const { data, error } = await supabase
        .from('okk_rules')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Error fetching rules:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No rules found.');
        return;
    }

    console.log(`Found ${data.length} recent rules:`);
    data.forEach(rule => {
        console.log('------------------------------------------------');
        console.log(`ID: ${rule.id}`);
        console.log(`Code: ${rule.code}`);
        console.log(`Name: ${rule.name}`);
        console.log(`Active: ${rule.active}`);
        console.log(`Type: ${rule.rule_type}`);
        console.log(`Created At: ${rule.created_at}`);
        console.log(`Condition SQL: ${rule.condition_sql}`);
        console.log(`Semantic Prompt: ${rule.semantic_prompt}`);
        console.log('------------------------------------------------');
    });
}

checkRecentRules();
