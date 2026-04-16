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
        <div className="relative flex overflow-hidden bg-[#eef3f7]" style={{ height: 'calc(100dvh - 64px)' }}>
            <div className={`min-w-0 flex-1 overflow-auto ${contentClassName}`.trim()}>
                {children}
            </div>
            <OKKConsultantPanel selectedOrder={selectedOrder} />
        </div>
    );
}