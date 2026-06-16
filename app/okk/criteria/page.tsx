import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { listAllCriteria } from '@/app/actions/okk-criteria';
import CriteriaAdmin from './criteria-admin';

export const dynamic = 'force-dynamic';

export default async function QualityCriteriaPage() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin'])) {
        return (
            <div className="p-8 text-center text-gray-500">
                Управление критериями качества доступно только администраторам.
            </div>
        );
    }
    const criteria = await listAllCriteria();
    return <CriteriaAdmin initial={criteria} />;
}
