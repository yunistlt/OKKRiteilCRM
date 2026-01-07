
import { getViolations } from '@/app/actions/rules';
import Link from 'next/link';

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
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Менеджер</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Детали</th>
                                <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {violations.map((v: any) => (
                                <tr key={v.id} className="hover:bg-gray-50">
                                    <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-500">
                                        {new Date(v.violation_time).toLocaleString('ru-RU')}
                                    </td>
                                    <td className="px-4 md:px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <span className={`px-2 inline-flex text-[10px] md:text-xs leading-5 font-semibold rounded-full 
                                                ${v.severity === 'critical' ? 'bg-red-100 text-red-800' :
                                                    v.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                                                        'bg-yellow-100 text-yellow-800'}`}>
                                                {v.okk_rules?.name || v.rule_code}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-900">
                                        {v.managers ? `${v.managers.first_name || ''} ${v.managers.last_name || ''}`.trim() || 'N/A' : 'N/A'}
                                    </td>
                                    <td className="px-4 md:px-6 py-4 text-xs md:text-sm text-gray-500 max-w-xs truncate">
                                        {v.details}
                                    </td>
                                    <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-500">
                                        {v.order_id ? (
                                            <a href={`https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">
                                                #{v.order_id}
                                            </a>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
