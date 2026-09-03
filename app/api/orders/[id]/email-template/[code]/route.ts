import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildOrderContext, renderTemplate } from '@/lib/templates/render';

export const dynamic = 'force-dynamic';

/**
 * Подставляет шаблон письма под конкретный заказ: возвращает готовые тему и тело,
 * которыми форма ответа заполняет поля. Менеджер потом правит текст руками.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; code: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id, code } = await params;

    const { data: template } = await supabase
        .from('email_templates')
        .select('name, subject, body')
        .eq('code', code)
        .maybeSingle();

    if (!template) {
        return NextResponse.json({ error: 'template_not_found' }, { status: 404 });
    }

    const context = await buildOrderContext(String(id));
    if (!context) {
        return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    }

    const subject = renderTemplate(template.subject, context);
    const body = renderTemplate(template.body, context);

    if (!subject.ok || !body.ok) {
        return NextResponse.json(
            { error: 'render_failed', details: subject.error || body.error },
            { status: 500 }
        );
    }

    return NextResponse.json({ ok: true, name: template.name, subject: subject.output, html: body.output });
}
