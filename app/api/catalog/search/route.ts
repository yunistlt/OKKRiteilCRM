/**
 * Поиск товара для состава заказа — напрямую по каталогу сайта.
 *
 * Своей копии номенклатуры у нас нет и не будет: товары живут на сайте
 * (решение владельца 30.09.2026). Названия и ссылки берём из витрины,
 * цену уточняем живым запросом к сайту, и честно помечаем, какая это цена.
 */
import { NextResponse } from 'next/server';
import { catalogSearch } from '@/lib/shtab/lvz';
import { enrichWithLivePrice } from '@/lib/webasyst';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const query = new URL(request.url).searchParams.get('q')?.trim() || '';
    if (query.length < 3) {
        return NextResponse.json({ items: [], note: 'Введите хотя бы три буквы' });
    }

    const found: any = await catalogSearch(query, 15);
    if (found?.available === false) {
        return NextResponse.json({ items: [], unavailable: true, note: String(found.reason || 'Каталог недоступен') });
    }

    const items = await enrichWithLivePrice(found.items || []);
    return NextResponse.json({
        items: items.map((item: any) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            priceLive: item.priceSource === 'live',
            priceSource: item.priceSource,
            category: item.category,
            url: item.url,
            active: item.active,
        })),
        // Три разных сообщения: нет цены вообще — это работа для сайта, а не
        // «цена из витрины» (требование владельца 02.10.2026).
        note: items.some((i: any) => i.priceSource === 'none')
            ? `У ${items.filter((i: any) => i.priceSource === 'none').length} из ${items.length} товаров на сайте не указана цена — её надо актуализировать`
            : items.some((i: any) => i.priceSource === 'cache')
                ? 'Часть цен — из выгрузки каталога, а не живые с сайта: сверьте перед КП'
                : null,
    });
}
