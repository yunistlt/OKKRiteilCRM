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
        .select('title, content, updated_at, section_key')
        .eq('slug', `instruction:${slug}`)
        .eq('is_active', true)
        .maybeSingle();

    if (!data) notFound();

    const article = data as { title: string; content: string; updated_at: string; section_key: string | null };

    /**
     * Шапка статьи — как в справке ЦехУспеха (требование владельца
     * 07.10.2026): видно, к какому разделу относится инструкция, и крупный
     * заголовок. Стандарт — golds/GOLD_HELP_ARTICLES.md.
     */
    const SECTIONS: Record<string, string> = {
        orders: 'Заказы',
        clients: 'Клиенты',
        calls: 'Звонки',
        salary: 'Зарплата',
        legal: 'Документы',
    };
    const sectionName = SECTIONS[String(article.section_key ?? '')] ?? 'Работа в ОКК';

    return (
        <div className="mx-auto max-w-3xl p-6">
            <Link href="/help" className="text-sm text-blue-700 hover:underline">← Все инструкции</Link>

            <div className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-500">
                <span className="inline-block h-2.5 w-2.5 bg-blue-600" />
                ОКК · {sectionName}
            </div>
            <h1 className="mb-2 mt-2 text-3xl font-bold leading-tight text-gray-900">{article.title}</h1>
            <p className="mb-5 border-b border-gray-900 pb-4 text-xs text-gray-500">
                Обновлено {new Date(article.updated_at).toLocaleDateString('ru-RU')}
            </p>

            {/* Шаги, выделенное важное и подсказки — как в Центре управления
                (решение владельца 05.10.2026). */}
            <HelpArticle content={article.content} />
        </div>
    );
}
