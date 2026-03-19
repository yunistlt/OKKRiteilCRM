import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Fetching managers from database...');
    const { data: managers, error: mgrError } = await supabase
        .from('managers')
        .select('*');

    if (mgrError) {
        console.error('Error fetching managers:', mgrError);
        return;
    }

    const tgManagers = managers.filter(m => m.raw_data && m.raw_data.telegram_username);
    console.log(`Found ${tgManagers.length} managers with Telegram usernames.`);

    let createdCount = 0;
    let skippedCount = 0;

    for (const m of tgManagers) {
        let tgName = m.raw_data.telegram_username.trim();
        // Remove leading '@' if present
        if (tgName.startsWith('@')) tgName = tgName.slice(1);

        const username = tgName;
        const password = tgName; // As requested, login = password
        const retailCrmId = m.id;

        // Check if user already exists based on retail_crm_manager_id OR username
        const { data: existingUser } = await supabase
            .from('users')
            .select('id, username')
            .or(`username.eq.${username},retail_crm_manager_id.eq.${retailCrmId}`)
            .limit(1)
            .maybeSingle();

        if (existingUser) {
            console.log(`User ${existingUser.username} already exists (skipping ${m.first_name} ${m.last_name}).`);
            skippedCount++;
            continue;
        }

        const { error: insertError } = await supabase
            .from('users')
            .insert({
                username: username,
                password_hash: password, // Currently using plain text for passwords in test
                role: 'manager',
                retail_crm_manager_id: retailCrmId
            });

        if (insertError) {
            console.error(`Error creating user ${username}:`, insertError.message);
        } else {
            console.log(`✅ Created user: ${username} (ID: ${retailCrmId}) for ${m.first_name} ${m.last_name}`);
            createdCount++;
        }
    }

    console.log(`\nFinished: Created ${createdCount} users, Skipped ${skippedCount} users.`);
}

main().catch(console.error);
