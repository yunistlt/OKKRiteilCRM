
import { getViolations } from '@/app/actions/rules';
import Link from 'next/link';
import ViolationRow from '@/components/ViolationRow';

export const dynamic = 'force-dynamic';

export default async function ViolationsPage({ searchParams }: { searchParams: { rule?: string } }) {
    const allViolations = await getViolations();
    const ruleFilter = searchParams?.rule;

    console.log('[Violations Page] searchParams:', searchParams);
    console.log('[Violations Page] ruleFilter:', ruleFilter);
    console.log('[Violations Page] Total violations:', allViolations.length);

    // Filter violations if rule parameter is present
    const violations = ruleFilter
        ? allViolations.filter((v: any) => {
            const match = v.rule_code === ruleFilter;
            console.log(`[Filter] ${v.rule_code} === ${ruleFilter}? ${match}`);
            return match;
        })
        : allViolations;

    console.log('[Violations Page] Filtered violations:', violations.length);

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold">Журнал Нарушений</h1>
                    {ruleFilter && (
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-sm text-gray-500">Фильтр по правилу:</span>
                            <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-bold border border-indigo-200">
                                {(violations.length > 0 && violations[0]?.okk_rules?.[0]?.name) || ruleFilter}
                            </span>
                            <Link
                                href="/violations"
                                className="text-xs text-gray-400 hover:text-gray-600 underline"
                            >
                                Сбросить фильтр
                            </Link>
                        </div>
                    )}
                </div>
                <Link
                    href="/settings/rules"
                    className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm font-medium transition w-full sm:w-auto text-center"
                >
                    Настроить Правила →
                </Link>
            </div>

            <div className="bg-white shadow rounded-lg overflow-hidden border">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Дата</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Правило</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Баллы</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Менеджер</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Детали</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Заказ / Статус</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {violations.map((v: any) => (
                                {
                                    violations.map((v: any) => (
                                        <ViolationRow key={v.id} violation={v} />
                                    ))
                                }
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
