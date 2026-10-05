
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

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        // scope=all — полный каталог (включая нерабочие/неактивные) для резолва имён статусов в UI.
        // По умолчанию — только рабочие активные статусы (выпадающие списки правил и т.п.).
        const all = searchParams.get('scope') === 'all';

        let query = supabase.from('statuses').select('code, name');
        if (!all) {
            query = query.eq('is_working', true).eq('is_active', true);
        }
        const { data, error } = await query.order('name');

        if (error) throw error;
        return NextResponse.json(data);
    } catch (e: any) {
        console.error('[Statuses API] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
