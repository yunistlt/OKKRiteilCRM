'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { SchemesTab, RosterTab, PlansTab } from './ConstructorTabs';
import BaseConfigTab from './BaseConfigTab';

const TABS = [
    ['schemes', 'Схемы (роли)'],
    ['roster', 'Реестр ОП'],
    ['plans', 'Планы'],
    ['base', 'Базовые параметры'],
] as const;

export default function SalarySettingsPage() {
    const [tab, setTab] = useState<(typeof TABS)[number][0]>('schemes');
    return (
        <div className="mx-auto max-w-5xl space-y-3 p-4">
            <div className="flex items-center gap-3">
                <Link href="/salary"><Button variant="outline" size="sm" className="h-8"><ArrowLeft className="mr-1 h-4 w-4" /> К зарплате</Button></Link>
                <h1 className="text-xl font-semibold">Настройки мотивации</h1>
            </div>
            <div className="flex gap-1 border-b text-sm">
                {TABS.map(([k, label]) => (
                    <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 ${tab === k ? 'border-b-2 border-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
                ))}
            </div>
            {tab === 'schemes' && <SchemesTab />}
            {tab === 'roster' && <RosterTab />}
            {tab === 'plans' && <PlansTab />}
            {tab === 'base' && <BaseConfigTab />}
        </div>
    );
}
