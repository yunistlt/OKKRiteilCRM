import AccessControlClient from './access-control-client';
import { loadAccessControlData } from './actions';

export const dynamic = 'force-dynamic';

export default async function AccessControlPage() {
    const data = await loadAccessControlData();

    return (
        <AccessControlClient
            initialAccounts={data.accounts}
            initialManagers={data.managers}
            initialRouteRules={data.routeRules}
            routeRulesTableReady={data.routeRulesTableReady}
        />
    );
}