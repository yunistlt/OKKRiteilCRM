'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { SchemesTab, RosterTab, PlansTab } from './ConstructorTabs';
import BaseConfigTab from './BaseConfigTab';
import GradesTab from './GradesTab';
import { useConsultantScreenHint } from '@/components/consultant/ConsultantScreenContext';

const TABS = [
    ['schemes', 'Схемы (роли)'],
    ['roster', 'Реестр ОП'],
    ['plans', 'Планы'],
    ['grades', 'Грейды'],
    ['base', 'Базовые параметры'],
] as const;

export default function SalarySettingsPage() {
    const [tab, setTab] = useState<(typeof TABS)[number][0]>('schemes');
    // Сообщаем Семёну активную вкладку, чтобы он искал ответ в нужной теме (грейды, схемы…).
    const tabLabel = TABS.find(([k]) => k === tab)?.[1] ?? '';
    useConsultantScreenHint(`Настройки мотивации → вкладка «${tabLabel}»`);
    return (
        <div className="w-full space-y-3 p-3">
            <div className="flex items-center gap-3 border-b">
                <Link href="/salary"><Button variant="outline" size="sm" className="h-8"><ArrowLeft className="mr-1 h-4 w-4" /> К зарплате</Button></Link>
                <div className="flex gap-1 text-sm">
                    {TABS.map(([k, label]) => (
                        <button key={k} onClick={() => setTab(k)} className={`-mb-px px-3 py-2 ${tab === k ? 'border-b-2 border-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
                    ))}
                </div>
            </div>
            {tab === 'schemes' && <SchemesTab />}
            {tab === 'roster' && <RosterTab />}
            {tab === 'plans' && <PlansTab />}
            {tab === 'grades' && <GradesTab />}
            {tab === 'base' && <BaseConfigTab />}
        </div>
    );
}
