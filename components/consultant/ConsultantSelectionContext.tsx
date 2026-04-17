'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PanelOrder } from '@/components/OKKConsultantPanel';

type ConsultantSelectionContextValue = {
    selectedOrder: PanelOrder | null;
    setSelectedOrder: (order: PanelOrder | null) => void;
};

const ConsultantSelectionContext = createContext<ConsultantSelectionContextValue | null>(null);

export function ConsultantSelectionProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [selectedOrder, setSelectedOrder] = useState<PanelOrder | null>(null);

    useEffect(() => {
        setSelectedOrder(null);
    }, [pathname]);

    const value = useMemo<ConsultantSelectionContextValue>(() => ({
        selectedOrder,
        setSelectedOrder,
    }), [selectedOrder]);

    return (
        <ConsultantSelectionContext.Provider value={value}>
            {children}
        </ConsultantSelectionContext.Provider>
    );
}

export function useConsultantSelection() {
    const context = useContext(ConsultantSelectionContext);

    if (!context) {
        throw new Error('useConsultantSelection must be used within ConsultantSelectionProvider');
    }

    return context;
}