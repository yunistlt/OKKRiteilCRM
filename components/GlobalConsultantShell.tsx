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
            {/* На телефоне снизу плавают бургер меню и кнопка Семёна — оставляем под них место, чтобы не закрывали последнюю строку. */}
            {/* relative нужен, чтобы карточка заказа раскрывалась внутри рабочей
                области, а не поверх меню слева и чата Семёна справа. */}
            <div data-ui-audit="page-scroller" className="relative min-w-0 flex-1 overflow-auto border-r border-slate-200 bg-white pb-20 md:pb-0">
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