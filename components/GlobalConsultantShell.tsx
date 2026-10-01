'use client';

import { usePathname } from 'next/navigation';
import OKKConsultantPanel from '@/components/OKKConsultantPanel';
import { ConsultantSelectionProvider, useConsultantSelection } from '@/components/consultant/ConsultantSelectionContext';
import { ConsultantScreenProvider } from '@/components/consultant/ConsultantScreenContext';
import DayPlanPanel from '@/components/sales-rop/DayPlanPanel';
import { useDayPlan } from '@/components/sales-rop/DayPlanContext';

function GlobalConsultantShellContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { selectedOrder } = useConsultantSelection();
    const { open: planOpen, setOpen: setPlanOpen } = useDayPlan();
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
            {planOpen ? (
                // План дня сверху, чат с Семёном — нижней третью: спросить у него
                // можно прямо по ходу разбора плана (решение владельца 01.10.2026).
                <div className="hidden h-full min-h-0 w-[26vw] min-w-[380px] max-w-[520px] shrink-0 flex-col md:flex">
                    <DayPlanPanel onClose={() => setPlanOpen(false)} />
                    <div className="flex min-h-0 flex-1 flex-col">
                        <OKKConsultantPanel selectedOrder={selectedOrder} stacked />
                    </div>
                </div>
            ) : (
                <OKKConsultantPanel selectedOrder={selectedOrder} />
            )}

            {/* На телефоне план показываем поверх: делить узкий экран пополам нечем. */}
            {planOpen && (
                <div className="fixed inset-x-0 bottom-0 top-14 z-[135] flex flex-col bg-white md:hidden">
                    <DayPlanPanel onClose={() => setPlanOpen(false)} />
                </div>
            )}
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