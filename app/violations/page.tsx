
import { getViolations } from '@/app/actions/rules';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ViolationsPage() {
    const violations = await getViolations();

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Журнал Нарушений</h1>
                <Link
                    href="/settings/rules"
                    className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm font-medium transition"
                >
                    Настроить Правила →
                </Link>
            </div>

            <div className="bg-white shadow rounded-lg overflow-hidden border">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Дата</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Правило</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Менеджер</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Детали</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {violations.map((v: any) => (
                            <tr key={v.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(v.violation_time).toLocaleString('ru-RU')}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                            ${v.severity === 'critical' ? 'bg-red-100 text-red-800' :
                                                v.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                                                    'bg-yellow-100 text-yellow-800'}`}>
                                            {v.okk_rules?.name || v.rule_code}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {v.managers?.name || 'Неизвестно'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500 max-w-md truncate" title={v.details}>
                                    {v.details}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600">
                                    {v.call_id ? `Call #${v.call_id}` : `Order #${v.order_id}`}
                                </td>
                            </tr>
                        ))}
                        {violations.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                    Нарушений пока нет (или фильтры слишком строгие).
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
