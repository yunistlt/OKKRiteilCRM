
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
    const name = process.argv[2];
    const { data, error } = await supabase
        .from('managers')
        .select('*')
        .ilike('name', `%${name}%`);

    if (error) console.error(error);
    console.log(data);
}
main();
