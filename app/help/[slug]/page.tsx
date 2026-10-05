/** Одна инструкция. Текст лежит в базе знаний — правится там же, без выкатки. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import HelpArticle from '@/components/help/HelpArticle';

export const dynamic = 'force-dynamic';

export default async function HelpArticlePage({ params }: { params: { slug: string } }) {
    const slug = decodeURIComponent(params.slug);

    const { data } = await supabase
        .from('okk_consultant_knowledge')
        .select('title, content, updated_at')
        .eq('slug', `instruction:${slug}`)
        .eq('is_active', true)
        .maybeSingle();

    if (!data) notFound();

    const article = data as { title: string; content: string; updated_at: string };

    return (
        <div className="p-6">
            <Link href="/help" className="text-sm text-blue-700 hover:underline">← Все инструкции</Link>

            <h1 className="mb-1 mt-3 text-xl font-semibold text-gray-900">{article.title}</h1>
            <p className="mb-4 text-xs text-gray-500">
                Обновлено {new Date(article.updated_at).toLocaleDateString('ru-RU')}
            </p>

            {/* Шаги, выделенное важное и подсказки — как в Центре управления
                (решение владельца 05.10.2026). */}
            <HelpArticle content={article.content} />
        </div>
    );
}
