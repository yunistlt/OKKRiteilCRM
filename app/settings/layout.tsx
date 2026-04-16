'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isFullWidthSettingsScreen = pathname.startsWith('/settings/ai-tools');

    return (
        <div className="min-h-full bg-gray-50/50">
            {/* 
                Local sidebar removed in favor of the global sidebar 
                to eliminate double navigation and systematize the UI.
            */}
            <div className={isFullWidthSettingsScreen ? 'min-h-full w-full' : 'max-w-7xl mx-auto'}>
                {children}
            </div>
        </div>
    );
}
