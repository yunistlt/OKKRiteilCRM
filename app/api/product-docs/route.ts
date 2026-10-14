/**
 * Поиск паспортов и инструкций на продукцию в базе ЦехУспеха.
 *
 * Своей копии этих файлов у нас нет намеренно — см. lib/product-docs/search.ts.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { externalDbConfigured } from '@/lib/shtab/external/client';
import { searchProductDocs, SOURCE_TITLES } from '@/lib/product-docs/search';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const query = String(params.get('q') ?? '').trim();
    const kindParam = String(params.get('kind') ?? 'docs');
    const kind = (['docs', 'all', 'passport', 'instruction'] as const).includes(kindParam as any)
        ? (kindParam as 'docs' | 'all' | 'passport' | 'instruction')
        : 'docs';

    if (!externalDbConfigured('tseh')) {
        return NextResponse.json(
            { docs: [], unavailable: 'База ЦехУспеха не подключена — обратитесь к администратору' },
            { status: 200 },
        );
    }

    if (query.length < 3) {
        return NextResponse.json({ docs: [], hint: 'Введите хотя бы три буквы: модель, название или часть имени файла' });
    }

    try {
        const found = await searchProductDocs({ query, kind, limit: 100 });
        const docs = found.map((doc) => ({
            source: doc.source,
            sourceTitle: SOURCE_TITLES[doc.source],
            fileId: doc.fileId,
            name: doc.fileName,
            ownerName: doc.ownerName,
            at: doc.changedAt,
            href: `/api/product-docs/file/${encodeURIComponent(doc.fileName || 'Документ')}?source=${doc.source}&id=${doc.fileId}`,
        }));
        return NextResponse.json({ docs });
    } catch (error) {
        console.error('[product-docs] поиск в ЦехУспехе не отработал:', error);
        return NextResponse.json(
            { docs: [], unavailable: 'База ЦехУспеха сейчас не отвечает. Файлы заказов это не затрагивает' },
            { status: 200 },
        );
    }
}
