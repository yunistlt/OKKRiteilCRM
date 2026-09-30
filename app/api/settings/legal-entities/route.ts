/**
 * Карточки наших юрлиц: ставка НДС и подписанты.
 *
 * Название, ИНН и банковские реквизиты берём из RetailCRM — их там ведут.
 * Ставку НДС в RetailCRM хранить негде, а зашивать в код нельзя: у ИП и у ООО
 * она разная и меняется решением человека. Поэтому она здесь.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { sellerOptions } from '@/lib/own-crm/documents';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
    }

    const [{ data: entities }, sellers] = await Promise.all([
        supabase
            .from('legal_entities')
            .select('id, short_name, full_name, inn, kind, active, site_code, vat_percent, signer_name, signer_title, note')
            .order('sort_order', { ascending: true }),
        sellerOptions().catch(() => []),
    ]);

    return NextResponse.json({ entities: entities || [], sites: sellers });
}

const saveSchema = z.object({
    id: z.coerce.number().int().positive(),
    vat_percent: z.coerce.number().min(0).max(100).nullable().optional(),
    site_code: z.string().trim().max(100).nullable().optional(),
    signer_name: z.string().trim().max(200).nullable().optional(),
    signer_title: z.string().trim().max(200).nullable().optional(),
});

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user || !['admin', 'rop'].includes(session.user.role)) {
        return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    const parsed = saveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ error: 'Неверные данные карточки' }, { status: 400 });
    }

    const { id, ...fields } = parsed.data;
    const { error } = await supabase
        .from('legal_entities')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
