
import { getRules } from '@/app/actions/rules';
import RuleCard from './rule-card';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function RulesSettingsPage() {
    const rules = await getRules();

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <Link href="/violations" className="text-sm text-gray-500 hover:text-gray-900 mb-2 block">← Назад к журналу</Link>
                    <h1 className="text-3xl font-bold text-gray-900">Настройка Правил ОКК</h1>
                    <p className="mt-2 text-gray-600">
                        Включайте и отключайте правила, настраивайте пороги срабатывания.
                        Изменения применяются к <strong>новым</strong> событиям мгновенно.
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {rules.map((rule: any) => (
                    <RuleCard key={rule.code} rule={rule} />
                ))}
            </div>

            <div className="mt-12 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
                <span className="font-bold">Совет:</span> Отключение правила не удаляет старые нарушения, но предотвращает появление новых.
            </div>
        </div>
    );
}
