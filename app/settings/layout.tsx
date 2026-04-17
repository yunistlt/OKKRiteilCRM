'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    usePathname();

    return (
        <div className="min-h-full bg-gray-50/50">
            {/* 
                Local sidebar removed in favor of the global sidebar 
                to eliminate double navigation and systematize the UI.
            */}
            <div className="min-h-full w-full">
                {children}
            </div>
        </div>
    );
}
