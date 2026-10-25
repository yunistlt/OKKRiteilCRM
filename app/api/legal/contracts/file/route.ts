import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { saveContractFile } from '@/lib/legal/contract-file';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/legal/contracts/file?id=<договор> — скачать договор файлом.
 *
 * Реестр юротдела и карточка заказа отдают один и тот же файл. Если файла ещё
 * нет (договор составлен до того, как мы начали их собирать), он собирается
 * здесь же на лету — человеку не нужно знать, что чего-то не хватало.
 */
export async function GET(req: Request) {
    const session = await getSession();
    // Маршрут живёт под /api/legal, а он открыт админу и юристу. Менеджер
    // берёт тот же файл из «Файлов» заказа — там он лежит обычной записью.
    if (!hasAnyRole(session, ['admin', 'jurist'])) {
        return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'Нужен номер договора' }, { status: 400 });

    const { data } = await supabase
        .from('order_contracts')
        .select('id, order_number, order_id, kind, title, body_text, version, pdf_path, docx_path')
        .eq('id', Number(id))
        .is('deleted_at', null)
        .maybeSingle();

    const contract = data as any;
    if (!contract) return NextResponse.json({ error: 'Договор не найден' }, { status: 404 });

    /**
     * Форму договора прислал клиент — отдаём ровно его файл, как есть.
     * Собирать его из текста нельзя: получится наш документ с чужими словами,
     * а юристу нужен подлинник (просьба Ирины Гордеевой 16.10.2026). Файл может
     * быть и .docx — тогда он лежит в `docx_path`.
     */
    if (contract.kind === 'klient') {
        const clientPath = (contract.pdf_path || contract.docx_path) as string | null;
        if (!clientPath) {
            return NextResponse.json({ error: 'Файл договора клиента не приложен' }, { status: 404 });
        }

        const file = await supabase.storage.from('okk-assets').download(clientPath);
        if (file.error || !file.data) {
            return NextResponse.json({ error: 'Файл договора не читается' }, { status: 502 });
        }

        const bytes = Buffer.from(await file.data.arrayBuffer());
        // Имя и тип — по самому файлу: имя клиентского файла хранится в «Файлах»
        // заказа, здесь берём расширение из пути, чтобы браузер не ошибся.
        const ext = (clientPath.split('.').pop() || '').toLowerCase();
        const types: Record<string, string> = {
            pdf: 'application/pdf',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            doc: 'application/msword',
            txt: 'text/plain; charset=utf-8',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
        };
        const clientName = `Договор клиента №${contract.order_number}.${ext || 'pdf'}`;
        return new NextResponse(bytes, {
            headers: {
                'Content-Type': types[ext] || 'application/octet-stream',
                'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(clientName)}`,
                'Cache-Control': 'private, no-store',
            },
        });
    }

    let path = contract.pdf_path as string | null;
    if (!path) {
        const built = await saveContractFile({
            contractId: String(contract.id),
            orderNumber: String(contract.order_number),
            orderId: contract.order_id ?? null,
            title: String(contract.title),
            bodyText: String(contract.body_text ?? ''),
            version: contract.version ?? null,
            author: session?.user?.email ?? null,
        });
        if (!built.ok) return NextResponse.json({ error: `Файл не собрался: ${built.reason}` }, { status: 502 });
        path = built.path;
    }

    const stored = await supabase.storage.from('okk-assets').download(path);
    if (stored.error || !stored.data) {
        return NextResponse.json({ error: 'Файл договора не читается' }, { status: 502 });
    }

    const bytes = Buffer.from(await stored.data.arrayBuffer());
    const name = `Договор №${contract.order_number}.pdf`;
    return new NextResponse(bytes, {
        headers: {
            'Content-Type': 'application/pdf',
            // inline — договор открывается в браузере, а не скачивается молча.
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
            'Cache-Control': 'private, no-store',
        },
    });
}
