'use client';

import { usePathname } from 'next/navigation';
import OKKConsultantPanel from '@/components/OKKConsultantPanel';
import { ConsultantSelectionProvider, useConsultantSelection } from '@/components/consultant/ConsultantSelectionContext';
import { ConsultantScreenProvider } from '@/components/consultant/ConsultantScreenContext';

function GlobalConsultantShellContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { selectedOrder } = useConsultantSelection();
    const hideConsultant = pathname === '/login' || pathname.startsWith('/messenger');

    if (hideConsultant) {
        return <>{children}</>;
    }

    return (
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
            <div className="min-w-0 flex-1 overflow-auto border-r border-slate-200 bg-white">
                {children}
            </div>
            <OKKConsultantPanel selectedOrder={selectedOrder} />
        </div>
    );
}

export default function GlobalConsultantShell({ children }: { children: React.ReactNode }) {
    return (
        <ConsultantScreenProvider>
            <ConsultantSelectionProvider>
                <GlobalConsultantShellContent>{children}</GlobalConsultantShellContent>
            </ConsultantSelectionProvider>
        </ConsultantScreenProvider>
    );
}