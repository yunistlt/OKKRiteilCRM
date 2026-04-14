import AccessControlClient from './access-control-client';
import { loadAccessControlData } from './actions';
import { DEFAULT_ROUTE_RULES } from '@/lib/rbac';
import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/access-control';

export const dynamic = 'force-dynamic';

export default async function AccessControlPage() {
    try {
        const data = await loadAccessControlData();

        return (
            <AccessControlClient
                initialAccounts={data.accounts}
                initialManagers={data.managers}
                initialRouteRules={data.routeRules}
                routeRulesTableReady={data.routeRulesTableReady}
                initialRoleCapabilities={data.roleCapabilities}
                roleCapabilitiesTableReady={data.roleCapabilitiesTableReady}
            />
        );
    } catch (error: any) {
        console.error('[AccessControlPage] Failed to load access control data:', error);

        return (
            <AccessControlClient
                initialAccounts={[]}
                initialManagers={[]}
                initialRouteRules={DEFAULT_ROUTE_RULES}
                routeRulesTableReady={false}
                initialRoleCapabilities={DEFAULT_ROLE_CAPABILITIES}
                roleCapabilitiesTableReady={false}
            />
        );
    }
}