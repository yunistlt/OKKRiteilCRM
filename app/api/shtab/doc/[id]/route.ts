import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildPdf } from '@/lib/shtab/tamara-doc';

export const dynamic = 'force-dynamic';
// Сборка PDF идёт средствами Node: в edge-окружении нет ни файловой системы для
// шрифтов, ни потоков, на которых работает генератор.
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/shtab/doc/<id> — скачать документ, сделанный Тамарой.
//
// PDF собирается в момент скачивания из сохранённой разметки: так документ
// всегда свежей вёрстки, не нужно хранилище и нечего чистить.
//
// Доступ: RBAC /api/shtab → только admin. В документах лежат деньги, фамилии и
// разбор работы людей.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const id = Number(params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: 'Неверный номер документа' }, { status: 400 });
        }

        const { data: doc, error } = await supabase
            .from('shtab_tamara_doc')
            .select('id, title, subtitle, body, opened')
            .eq('id', id)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!doc) return NextResponse.json({ error: 'Такого документа нет' }, { status: 404 });

        const pdfBytes = await buildPdf({
            title: String((doc as any).title),
            subtitle: (doc as any).subtitle ?? undefined,
            body: String((doc as any).body),
        });

        // Счётчик открытий — мягко: сорвавшийся апдейт не повод не отдать файл.
        await supabase
            .from('shtab_tamara_doc')
            .update({ opened: Number((doc as any).opened ?? 0) + 1 })
            .eq('id', id)
            .then(() => null, () => null);

        // Имя файла — из названия документа: «document.pdf» в папке загрузок
        // через неделю ничего не значит. Латиница и цифры остаются, остальное
        // заменяется, чтобы имя не сломалось по дороге.
        const safe = String((doc as any).title)
            .replace(/[^\w\dА-Яа-яЁё\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 60);

        return new NextResponse(pdfBytes as any, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(safe || 'dokument')}.pdf`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
