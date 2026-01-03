import { supabase } from '../utils/supabase';

async function verifyRawTables() {
    console.log('=== VERIFYING RAW LAYER TABLES ===\n');

    const tables = ['raw_order_events', 'raw_telphin_calls'];
    let allGood = true;

    for (const table of tables) {
        try {
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });

            if (error) {
                console.log(`❌ Table '${table}' - ERROR:`, error.message);
                allGood = false;
            } else {
                console.log(`✅ Table '${table}' - EXISTS (${count || 0} rows)`);
            }
        } catch (e: any) {
            console.log(`❌ Table '${table}' - NOT FOUND`);
            allGood = false;
        }
    }

    if (allGood) {
        console.log('\n✅ All RAW layer tables are ready!');
    } else {
        console.log('\n❌ Some tables are missing. Please run the migration:');
        console.log('   See migrations/README_RAW_LAYER.md for instructions');
        process.exit(1);
    }
}

verifyRawTables();
