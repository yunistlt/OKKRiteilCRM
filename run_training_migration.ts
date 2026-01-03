import { supabase } from './utils/supabase';
import * as fs from 'fs';
import * as path from 'path';

async function runMigrations() {
    console.log('🔧 Running database migrations...\n');

    // Read the training_examples migration file
    const migrationPath = path.join(__dirname, 'migrations', '20260102_training_examples.sql');

    if (!fs.existsSync(migrationPath)) {
        console.error(`❌ Migration file not found: ${migrationPath}`);
        process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log(`📄 Applying migration: 20260102_training_examples.sql`);
    console.log('---');
    console.log(migrationSQL);
    console.log('---\n');

    try {
        // Execute the migration SQL
        const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

        if (error) {
            console.error('❌ Migration failed:', error);

            // Try alternative approach: use Supabase client directly
            console.log('\n🔄 Trying alternative approach...\n');

            // Split by semicolons and execute each statement
            const statements = migrationSQL
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            for (const statement of statements) {
                console.log(`Executing: ${statement.substring(0, 50)}...`);
                const { error: stmtError } = await supabase.rpc('exec_sql', { sql: statement });
                if (stmtError) {
                    console.error(`Error: ${stmtError.message}`);
                }
            }
        } else {
            console.log('✅ Migration applied successfully!');
        }

        // Verify table exists
        console.log('\n🔍 Verifying table creation...');
        const { data, error: verifyError } = await supabase
            .from('training_examples')
            .select('count')
            .limit(1);

        if (verifyError) {
            console.error('❌ Table verification failed:', verifyError.message);
            console.log('\n⚠️  You may need to run this migration manually in your Supabase SQL Editor:');
            console.log(migrationPath);
        } else {
            console.log('✅ Table exists and is accessible!');
        }

    } catch (err) {
        console.error('❌ Unexpected error:', err);
        console.log('\n⚠️  Please run the migration manually in your Supabase SQL Editor.');
        console.log(`Migration file: ${migrationPath}`);
    }
}

runMigrations()
    .then(() => {
        console.log('\n✨ Migration process completed!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Fatal error:', err);
        process.exit(1);
    });
