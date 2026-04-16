'use client';

import { ReactNode } from 'react';
import OKKConsultantPanel, { type PanelOrder } from '@/components/OKKConsultantPanel';

export default function OKKConsultantWorkspace({
    children,
    selectedOrder = null,
    contentClassName = '',
}: {
    children: ReactNode;
    selectedOrder?: PanelOrder | null;
    contentClassName?: string;
}) {
    return (
        <div className="relative flex overflow-hidden bg-white" style={{ height: 'calc(100dvh - 64px)' }}>
            <div className={`min-w-0 flex-1 overflow-auto border-r border-slate-200 bg-white ${contentClassName}`.trim()}>
                {children}
            </div>
            <OKKConsultantPanel selectedOrder={selectedOrder} />
        </div>
    );
}