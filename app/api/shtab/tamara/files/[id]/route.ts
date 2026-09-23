import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// DELETE /api/shtab/tamara/files/[id] — убрать файл из разговора вместе с файлом.

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(params.id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

        const { data: file, error } = await supabase
            .from('shtab_tamara_file')
            .select('storage_bucket, storage_path')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!file) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

        const { error: delError } = await supabase.from('shtab_tamara_file').delete().eq('id', id);
        if (delError) throw new Error(delError.message);
        await supabase.storage.from(file.storage_bucket).remove([file.storage_path]).catch(() => undefined);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
