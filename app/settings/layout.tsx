'use client';

import React from 'react';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-full bg-gray-50/50">
            {/* 
                Local sidebar removed in favor of the global sidebar 
                to eliminate double navigation and systematize the UI.
            */}
            <div className="max-w-7xl mx-auto">
                {children}
            </div>
        </div>
    );
}
