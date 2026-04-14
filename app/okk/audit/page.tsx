import { redirect } from 'next/navigation';
import OKKConsultantAudit from '@/components/OKKConsultantAudit';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function OKKAuditPage() {
    const session = await getSession();

    if (!session?.user || session.user.role === 'manager') {
        redirect('/okk');
    }

    return <OKKConsultantAudit />;
}