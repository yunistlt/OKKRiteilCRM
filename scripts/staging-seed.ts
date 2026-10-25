/**
 * Наполнить тестовый стенд справочниками с прода.
 *
 * Решение владельца 22.10.2026: стенду нужны «все таблицы и триггеры», а не
 * данные. Но совсем пустая база бесполезна — не открывается ни один экран:
 * нет статусов, полей карточки, менеджеров и прав. Поэтому переносим ТОЛЬКО
 * справочники и настройки, без заказов, клиентов, звонков и писем.
 *
 * Боевые учётные записи не переносим: пароли и почта людей на стенде не нужны.
 *
 * Запуск (структура уже должна быть залита):
 *   npx tsx scripts/staging-seed.ts            # показать, что поедет
 *   npx tsx scripts/staging-seed.ts --apply
 */
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

/** Справочники и настройки: без них интерфейс пустой. */
const TABLES = [
    'retailcrm_dictionaries',
    'retailcrm_custom_fields',
    'managers',
    // Сначала сами статусы, потом их настройки: настройки на них ссылаются.
    'status_groups',
    'statuses',
    'status_settings',
    'access_route_rules',
    'notification_routes',
    'okk_rules',
    'okk_criteria',
    'ai_model_pricing',
    'ai_cost_settings',
    'salary_plan',
    // Настройки зарплаты: без них экран ведомости падает ошибкой «конфиг не задан».
    'salary_config',
    'salary_scheme',
    'salary_grade',
    'salary_manager_comp',
    'salary_duty',
    'sales_rop_settings',
    'widget_settings',
];

async function main() {
    const prodUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    const stagingUrl = process.env.STAGING_DATABASE_URL;
    if (!prodUrl || !stagingUrl) {
        console.error('Нужны DATABASE_URL (прод) и STAGING_DATABASE_URL (стенд) в .env.local');
        process.exit(1);
    }

    const prod = postgres(prodUrl, { ssl: 'require', max: 1 });
    const staging = postgres(stagingUrl, { ssl: 'require', max: 1 });

    for (const table of TABLES) {
        // Таблицы может не быть: справочник мог называться иначе — не падаем.
        const exists = await staging`
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = ${table}
        `;
        if (!exists.length) {
            console.log(`${table}: на стенде нет такой таблицы — пропускаем`);
            continue;
        }

        const rows = await prod`select * from ${prod(table)}`.catch(() => []);
        if (!rows.length) {
            console.log(`${table}: на проде пусто`);
            continue;
        }

        console.log(`${table}: ${rows.length} строк`);
        if (!APPLY) continue;

        await staging`delete from ${staging(table)}`.catch(() => undefined);
        // Пачками: справочники небольшие, но строки бывают широкие.
        for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            await staging`insert into ${staging(table)} ${staging(chunk as any)}`.catch((e: any) => {
                console.warn(`  ${table}: кусок ${i} не записался — ${e.message}`);
            });
        }
    }

    await prod.end();
    await staging.end();

    if (!APPLY) console.log('\nЭто показ. Повторите с --apply.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
