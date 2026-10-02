/**
 * Ссылки на карточки товаров сайта по артикулам позиций заказа.
 * Нужны составу заказа: название товара там кликабельно и ведёт на сайт.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { catalogLinks, catalogLinksConfigured } from '@/lib/own-crm/catalog-links';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    /** Идентификаторы товаров на сайте — из `offer.externalId` позиции заказа. */
    siteIds: z.array(z.union([z.string().trim().max(40), z.number()])).max(300).optional(),
    /** Артикулы — запасной ключ. */
    articles: z.array(z.string().trim().max(200)).max(300).optional(),
});

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Не понял, по каким товарам искать ссылки' }, { status: 400 });
    }

    const links = await catalogLinks({ siteIds: parsed.data.siteIds, articles: parsed.data.articles });

    return NextResponse.json({
        available: catalogLinksConfigured(),
        links: Object.fromEntries(links.map((link) => [link.key, { url: link.url, name: link.name }])),
    });
}
