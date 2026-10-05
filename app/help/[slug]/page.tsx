/** Одна инструкция. Текст лежит в базе знаний — правится там же, без выкатки. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/utils/supabase';

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

            {/* Текст инструкции хранится как обычный текст: его пишут люди, а не
                разметка. Переносы строк сохраняем, чтобы шаги читались шагами. */}
            <div className="max-w-3xl whitespace-pre-line border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-800">
                {article.content}
            </div>
        </div>
    );
}
