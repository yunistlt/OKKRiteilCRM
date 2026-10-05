/**
 * Инструкции для людей: как пользоваться системой.
 *
 * Решение владельца 05.10.2026: «памятку сделай в хелпере как инструкцию на
 * сайте и дай ссылку». Инструкции лежат в базе знаний Семёна — там же, где
 * остальные его знания (закон: знания ИИ в РАГ, не в файлах), поэтому он может
 * на них ссылаться в ответах.
 */
import Link from 'next/link';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
    const { data } = await supabase
        .from('okk_consultant_knowledge')
        .select('slug, title, updated_at')
        .eq('type', 'instruction')
        .eq('is_active', true)
        .order('title');

    const items = (data ?? []) as Array<{ slug: string; title: string; updated_at: string }>;

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-xl font-semibold text-gray-900">Инструкции</h1>
                <p className="mt-1 text-sm text-gray-500">Как делать то, что делается не каждый день.</p>
            </div>

            {items.length === 0 ? (
                <p className="bg-white px-4 py-6 text-sm text-gray-500">Инструкций пока нет.</p>
            ) : (
                <div className="border border-gray-200 bg-white">
                    {items.map((item) => (
                        <Link
                            key={item.slug}
                            href={`/help/${encodeURIComponent(item.slug.replace('instruction:', ''))}`}
                            className="block border-b border-gray-100 px-4 py-3 hover:bg-blue-50"
                        >
                            <span className="text-sm font-semibold text-blue-700">{item.title}</span>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
