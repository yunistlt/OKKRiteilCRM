/**
 * Проверка прав на заказы по ролям: берём правила из таблицы access_route_rules
 * (как это делает middleware), накладываем на правила из кода и спрашиваем
 * у настоящего резолвера, пустит ли он роль на страницу и в API заказа.
 */
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { canAccessPathWithRules, DEFAULT_ROUTE_RULES, normalizeAllowedRoles, type RouteRule } from '../lib/rbac';
import type { AppRole } from '../lib/auth';

const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const dbUrl = (env.match(/^DATABASE_URL=(.*)$/m) || env.match(/^POSTGRES_URL=(.*)$/m))![1].trim().replace(/^["']|["']$/g, '');

async function main() {
const sql = postgres(dbUrl, { ssl: 'require' });

const rows = await sql<{ prefix: string; label: string | null; description: string | null; category: string | null; allowed_roles: unknown }[]>`
    select prefix, label, description, category, allowed_roles from access_route_rules order by prefix asc
`;
await sql.end();

const overrides = new Map<string, RouteRule>(
    rows.map((item) => [
        item.prefix,
        {
            prefix: item.prefix,
            label: item.label || item.prefix,
            description: item.description || '',
            category: item.category || 'Доступ',
            allowed: normalizeAllowedRoles(item.allowed_roles),
        },
    ])
);

const merged = DEFAULT_ROUTE_RULES.map((rule) => overrides.get(rule.prefix) || rule);
const extra = Array.from(overrides.values()).filter((rule) => !DEFAULT_ROUTE_RULES.some((d) => d.prefix === rule.prefix));
const rules = [...merged, ...extra];

const roles: AppRole[] = ['buhgalter', 'jurist', 'logistics'];
const paths = [
    '/orders',
    '/api/orders',
    '/api/orders/53971',
    '/api/orders/task-alerts',
    '/api/orders/view-fields',
    '/api/orders/list',
    '/api/orders/send-email',
    '/api/notifications',
    '/api/settings/view',
    '/api/settings/templates',
    '/api/okk/filter-options',
    '/api/okk/filter-presets',
    '/api/okk/managers',
    '/api/calls/alerts',
    '/api/calls',
    '/api/emails/incoming-alerts',
    '/api/files/search',
    '/api/dictionaries',
    '/api/statuses',
    '/help',
];

for (const role of roles) {
    console.log(`\n${role}:`);
    for (const path of paths) {
        const clean = path.split('?')[0];
        console.log(`  ${canAccessPathWithRules(role, clean, rules) ? 'пускает' : 'НЕ пускает'}  ${path}`);
    }
}

}

main();
