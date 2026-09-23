import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// GET    /api/shtab/doc/[id] — ссылка на файл, живущая пять минут.
// DELETE /api/shtab/doc/[id] — убрать документ вместе с файлом.
//
// Корзина закрытая, поэтому прямой ссылки на файл нет и быть не должно:
// должностные папки — не публичные документы.

function parseId(raw: string): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const id = parseId(params.id);
        if (!id) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const { data: doc, error } = await supabase
            .from('shtab_post_doc')
            .select('storage_bucket, storage_path, file_name')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!doc) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });

        const { data: signed, error: signError } = await supabase.storage
            .from(doc.storage_bucket)
            .createSignedUrl(doc.storage_path, 300, { download: doc.file_name });
        if (signError) throw new Error(signError.message);

        return NextResponse.json({ url: signed?.signedUrl ?? null });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
        const id = parseId(params.id);
        if (!id) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const { data: doc, error } = await supabase
            .from('shtab_post_doc')
            .select('storage_bucket, storage_path')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!doc) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 });

        // Сначала строка, потом файл: если упадёт удаление файла, в хранилище
        // останется сирота — это неприятно, но не страшно. Обратный порядок
        // оставил бы в списке документ, который не открывается.
        const { error: delError } = await supabase.from('shtab_post_doc').delete().eq('id', id);
        if (delError) throw new Error(delError.message);
        await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path]).catch(() => undefined);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
