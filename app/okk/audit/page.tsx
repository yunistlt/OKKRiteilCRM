import { redirect } from 'next/navigation';
import OKKConsultantAudit from '@/components/OKKConsultantAudit';
import OKKConsultantWorkspace from '@/components/OKKConsultantWorkspace';
import { getSession } from '@/lib/auth';
import { getEffectiveCapabilityForRole } from '@/lib/access-control-server';

export const dynamic = 'force-dynamic';

export default async function OKKAuditPage() {
    const session = await getSession();
    const capability = await getEffectiveCapabilityForRole(session?.user?.role);

    if (!session?.user || !capability.canViewAudit) {
        redirect('/okk');
    }

    return (
        <OKKConsultantWorkspace>
            <OKKConsultantAudit />
        </OKKConsultantWorkspace>
    );
}