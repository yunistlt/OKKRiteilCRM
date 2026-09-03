import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildOrderContext, renderTemplate } from '@/lib/templates/render';

export const dynamic = 'force-dynamic';

const PAGE_CSS = (orientation: string, format: string) => `
    @page { size: ${format} ${orientation}; margin: 12mm; }
    body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
    table { border-collapse: collapse; width: 100%; }
    .no-print { position: fixed; top: 8px; right: 8px; }
    @media print { .no-print { display: none; } }
`;

/**
 * Готовый к печати документ по заказу.
 *
 * Отдаём HTML, а не PDF: у RetailCRM PDF собирает wkhtmltopdf на сервере, на Vercel его нет.
 * Менеджер жмёт ⌘P и сохраняет в PDF средствами браузера — результат тот же, зависимостей ноль.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; code: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id, code } = await params;

    const { data: template } = await supabase
        .from('document_templates')
        .select('name, body, orientation, page_format, active')
        .eq('code', code)
        .maybeSingle();

    if (!template) {
        return new NextResponse(errorPage('Шаблон не найден', `Печатной формы с кодом «${code}» нет.`), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }

    const context = await buildOrderContext(String(id));
    if (!context) {
        return new NextResponse(errorPage('Заказ не найден', `Заказа №${id} нет в базе.`), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }

    const rendered = renderTemplate(template.body, context);
    if (!rendered.ok) {
        return new NextResponse(
            errorPage('Ошибка в шаблоне', `Шаблон «${template.name}» не собрался: ${rendered.error}`),
            { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }

    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>${escapeHtml(template.name)} — заказ №${escapeHtml(String(id))}</title>
<style>${PAGE_CSS(template.orientation || 'portrait', template.page_format || 'A4')}</style>
</head><body>
<button class="no-print" onclick="window.print()">Печать</button>
${rendered.output}
</body></html>`;

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function errorPage(title: string, text: string) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,Arial,sans-serif;padding:24px">
<h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(title)}</h1>
<p style="font-size:13px;color:#444;margin:0">${escapeHtml(text)}</p>
</body></html>`;
}
