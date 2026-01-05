'use client';

import { useState } from 'react';
import RuleCard from './rule-card';
import NewRuleModal from './new-rule-modal';
import Link from 'next/link';

export default function RulesClient({ rules, stats }: { rules: any[], stats: Record<string, number> }) {
    const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');

    const activeRules = rules.filter(r => r.is_active);
    const archivedRules = rules.filter(r => !r.is_active);

    const displayedRules = activeTab === 'active' ? activeRules : archivedRules;

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <Link href="/violations" className="text-sm text-gray-500 hover:text-gray-900 mb-2 block">← Назад к журналу</Link>
                    <h1 className="text-3xl font-bold text-gray-900">Настройка Правил ОКК</h1>
                    <p className="mt-2 text-gray-600">
                        Включайте и отключайте правила, настраивайте пороги срабатывания.
                    </p>
                </div>
                {/* Only allow creating new rules in Active tab? Or always? Always is fine. */}
                <NewRuleModal />
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-6">
                <button
                    onClick={() => setActiveTab('active')}
                    className={`pb-4 px-4 text-sm font-medium transition-colors relative ${activeTab === 'active'
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    Активные ({activeRules.length})
                </button>
                <button
                    onClick={() => setActiveTab('archived')}
                    className={`pb-4 px-4 text-sm font-medium transition-colors relative ${activeTab === 'archived'
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    Архив ({archivedRules.length})
                </button>
            </div>

            <div className="space-y-6">
                {displayedRules.length === 0 && (
                    <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg dashed border border-gray-200">
                        {activeTab === 'active' ? 'Нет активных правил' : 'Архив пуст'}
                    </div>
                )}
                {displayedRules.map((rule: any) => (
                    <RuleCard
                        key={rule.code}
                        rule={rule}
                        violationCount={stats[rule.code] || 0}
                    />
                ))}
            </div>

            <div className="mt-12 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
                <span className="font-bold">Совет:</span> Изменение правил реализовано через создание новых версий (Immutable Rules). Старые версии попадают в Архив.
            </div>
        </div>
    );
}
