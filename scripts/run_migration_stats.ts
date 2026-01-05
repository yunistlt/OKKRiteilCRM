
import { supabase } from './utils/supabase';
import fs from 'fs';

async function run() {
    const sql = fs.readFileSync('create_dialogue_stats.sql', 'utf8');

    // Split by semicolons for basic execution (won't work for complex stuff but fine for this)
    const queries = sql.split(';').filter(q => q.trim().length > 0);

    for (const query of queries) {
        console.log('Executing:', query.substring(0, 50) + '...');
        const { error } = await supabase.rpc('exec_sql', { sql_query: query });
        if (error) {
            // Fallback: บางครั้ง exec_sql ไม่มี หรือติด permission
            // ถ้าไม่ผ่านจริงๆ ให้แจ้ง user
            console.error('Migration failed via exec_sql:', error.message);
            console.log('PLEASE EXECUTE THE SQL MANUALLY IN SUPABASE SQL EDITOR:');
            console.log(sql);
            return;
        }
    }
    console.log('Migration completed successfully!');
}

run();
