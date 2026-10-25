
/**
 * Каталог статусов заказа.
 *
 * Читать его должен каждый, кто видит заказы: по нему интерфейс показывает
 * русское имя статуса вместо кода. Раздел был открыт только администратору, и
 * менеджер видел в карточке «Soglasovanie Otmeny» вместо «Согласование
 * отмены» (замечено владельцем 01.10.2026). Править статусы по-прежнему может
 * только администратор — это другие методы.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { loadStatusDirectory } from '@/lib/own-crm/status-code';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        // scope=all — полный каталог (включая нерабочие/неактивные) для резолва имён статусов в UI.
        // По умолчанию — только рабочие активные статусы (выпадающие списки правил и т.п.).
        const all = searchParams.get('scope') === 'all';

        // Состав и названия статусов — с доски «Статусы и переходы»:
        // один справочник статусов на весь проект.
        const rows = await loadStatusDirectory({ withInactive: all });
        const data = rows
            .filter((row) => (all ? true : row.isWorking))
            .map((row) => ({ code: row.code, name: row.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

        return NextResponse.json(data);
    } catch (e: any) {
        console.error('[Statuses API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
