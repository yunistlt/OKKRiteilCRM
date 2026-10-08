import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Телефоны компании в карточке клиента.
 *
 * Просьба менеджеров 08.10.2026: «в карточке клиента не вижу поля с номерами
 * телефонов». Номер был только у контактного лица и один, а у компании их
 * обычно несколько: приёмная, снабжение, мобильный директора.
 *
 * Храним в `clients.phones` — колонка уже есть и приехала из RetailCRM, своей
 * заводить незачем (закон «проверь, что такого ещё нет»).
 */
const BodySchema = z.object({
    phones: z.array(z.string().trim().max(40)).max(20),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Проверьте номера' }, { status: 400 });

    // Пустые строки не храним: менеджер добавил поле и передумал.
    const phones = Array.from(new Set(parsed.data.phones.map((p) => p.trim()).filter(Boolean)));

    const { error } = await supabase
        .from('clients')
        .update({ phones, updated_at: new Date().toISOString() })
        .eq('id', Number(id));

    if (error) {
        console.error('[client-phones] не сохранились:', error);
        return NextResponse.json({ error: 'Телефоны не сохранились' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, phones });
}
