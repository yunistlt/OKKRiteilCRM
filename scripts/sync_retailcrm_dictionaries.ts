import postgres from 'postgres';
import dotenv from 'dotenv';
import { fetchRetailcrmCatalog, isRetailcrmConfigured } from '@/lib/retailcrm/dictionaries-sync';

// Полный синк каталога RetailCRM локально (без supabase-service): тянет все
// справочники и поля через библиотеку, пишет напрямую в БД через postgres-js.
//   npm run retailcrm:sync-dictionaries
dotenv.config({ path: '.env.local' });

async function main() {
    if (!isRetailcrmConfigured()) {
        console.error('Нет RETAILCRM_URL / RETAILCRM_API_KEY в .env.local — синк невозможен.');
        process.exit(1);
    }
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('Нет DATABASE_URL в .env.local.');
        process.exit(1);
    }
    const sql = postgres(dbUrl, { ssl: 'require' });
    try {
        console.log('Тяну каталог RetailCRM…');
        const { dictionaryCount, dictRows, fieldRows } = await fetchRetailcrmCatalog();
        console.log(`Получено: справочников=${dictionaryCount}, значений=${dictRows.length}, полей=${fieldRows.length}`);

        for (const r of dictRows) {
            await sql`
                INSERT INTO public.retailcrm_dictionaries (entity_type, dictionary_code, item_code, item_name, updated_at)
                VALUES (${r.entity_type}, ${r.dictionary_code}, ${r.item_code}, ${r.item_name}, now())
                ON CONFLICT (entity_type, dictionary_code, item_code)
                DO UPDATE SET item_name = EXCLUDED.item_name, updated_at = now()`;
        }
        for (const f of fieldRows) {
            await sql`
                INSERT INTO public.retailcrm_custom_fields (entity, code, name, type, dictionary, ordering, in_filter, in_list, display_area, raw, updated_at)
                VALUES (${f.entity}, ${f.code}, ${f.name}, ${f.type}, ${f.dictionary}, ${f.ordering}, ${f.in_filter}, ${f.in_list}, ${f.display_area}, ${sql.json(f.raw)}, now())
                ON CONFLICT (entity, code)
                DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, dictionary=EXCLUDED.dictionary, ordering=EXCLUDED.ordering,
                              in_filter=EXCLUDED.in_filter, in_list=EXCLUDED.in_list, display_area=EXCLUDED.display_area, raw=EXCLUDED.raw, updated_at=now()`;
        }
        console.log('Синк завершён.');
    } catch (e: any) {
        console.error('Ошибка синка:', e.message);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

main();
