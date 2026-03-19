import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Fetching manager 98...');
    const { data: manager, error: mError } = await supabase
        .from('managers')
        .select('*')
        .eq('id', 98)
        .single();

    if (mError) {
        console.error('Error fetching manager:', mError);
        return;
    }

    if (manager && manager.raw_data && manager.raw_data.telegram_username) {
        let tgName = manager.raw_data.telegram_username.trim();
        if (tgName.startsWith('@')) tgName = tgName.slice(1);

        console.log(`Updating 'manager1' to username/password: ${tgName}`);

        const { error: uError } = await supabase
            .from('users')
            .update({ username: tgName, password_hash: tgName })
            .eq('username', 'manager1');

        if (uError) {
            console.error('Error updating user:', uError);
        } else {
            console.log(`✅ Successfully updated Евгения Матвеева. Login & password: ${tgName}`);
        }
    } else {
        console.log('Manager 98 does not have a telegram username in raw_data.');
    }
}

main().catch(console.error);
