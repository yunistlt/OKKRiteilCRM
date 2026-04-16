'use client';

import { useState } from 'react';
import AIRouterPanel from '@/components/AIRouterPanel';
import OKKConsultantWorkspace from '@/components/OKKConsultantWorkspace';
import type { PanelOrder } from '@/components/OKKConsultantPanel';

export default function AIToolsPage() {
    const [consultantOrder, setConsultantOrder] = useState<PanelOrder | null>(null);

    return (
        <OKKConsultantWorkspace selectedOrder={consultantOrder}>
            <div className="w-full min-h-full bg-[#eef3f7]">
                <AIRouterPanel onConsultantOrderChange={setConsultantOrder} />
            </div>
        </OKKConsultantWorkspace>
    );
}
