'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import DateRangePicker from './DateRangePicker';

interface EfficiencyRow {
    manager_id: number;
    manager_name: string;
    total_minutes: number;
    processed_orders: number;
}

export default function Header() {
    return (
        <header className="bg-gray-900 text-white shadow-md">
            <div className="container mx-auto px-4 py-3 flex justify-between items-center">

                {/* Logo / Home Link */}
                {/* Logo / Home Link */}
                <Link href="/" className="text-xl font-bold tracking-tight text-blue-400 hover:text-blue-300">
                    OKKRiteilCRM
                </Link>

                {/* Global Date Filter */}
                <div className="hidden md:block">
                    <Suspense fallback={<div className="w-32 h-10 bg-gray-800 animate-pulse rounded-xl" />}>
                        <DateRangePicker />
                    </Suspense>
                </div>

                {/* Breadcrumbs / Settings */}
                <div className="flex items-center gap-4">
                    <Link href="/settings" className="text-gray-400 hover:text-white transition-colors text-sm font-bold flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        Настройки
                    </Link>
                    <div className="text-[10px] text-gray-600 font-black">v1.2</div>
                </div>
            </div>
        </header>
    );
}
