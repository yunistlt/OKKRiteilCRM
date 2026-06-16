import { getRules, getRuleStats, listRoleGroups } from '@/app/actions/rules';
import RulesClient from './rules-client';

export const dynamic = 'force-dynamic';

export default async function RulesSettingsPage() {
    const [rules, stats, roleGroups] = await Promise.all([
        getRules(),
        getRuleStats(),
        listRoleGroups(),
    ]);

    // Карта код→имя роли (имена строго из RetailCRM) для человекочитаемых бейджей.
    const roleNames: Record<string, string> = {};
    for (const g of roleGroups) roleNames[g.code] = g.name;

    return <RulesClient rules={rules} stats={stats} roleNames={roleNames} />;
}
