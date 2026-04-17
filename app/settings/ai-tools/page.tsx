'use client';

import { useEffect, useState } from 'react';
import AIRouterPanel from '@/components/AIRouterPanel';
import type { PanelOrder } from '@/components/OKKConsultantPanel';
import { useConsultantSelection } from '@/components/consultant/ConsultantSelectionContext';

export default function AIToolsPage() {
    const [consultantOrder, setConsultantOrder] = useState<PanelOrder | null>(null);
    const { setSelectedOrder } = useConsultantSelection();

    useEffect(() => {
        setSelectedOrder(consultantOrder);
    }, [consultantOrder, setSelectedOrder]);

    return (
        <div className="w-full min-h-full bg-[#eef3f7]">
            <AIRouterPanel onConsultantOrderChange={setConsultantOrder} />
        </div>
    );
}
