import { getRules, getRuleStats } from '@/app/actions/rules';
import RulesClient from './rules-client';

export const dynamic = 'force-dynamic';

export default async function RulesSettingsPage() {
    const rules = await getRules();
    const stats = await getRuleStats();

    return <RulesClient rules={rules} stats={stats} />;
}
