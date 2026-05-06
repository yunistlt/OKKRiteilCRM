import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LeadAnalyticsClient from './LeadAnalyticsClient';

export const dynamic = 'force-dynamic';

export default async function LeadCatcherAnalyticsPage() {
    const session = await getSession();
    if (!session) redirect('/login');

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
            <div className="max-w-5xl mx-auto">
                <LeadAnalyticsClient />
            </div>
        </div>
    );
}
