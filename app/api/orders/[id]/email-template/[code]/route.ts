import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { buildOrderContext, renderTemplate } from '@/lib/templates/render';
import { writeLetter } from '@/lib/templates/ai-letter';
import { managerSignature, withSignature } from '@/lib/templates/signature';

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
        .select('name, subject, body, mode, prompt')
        .eq('code', code)
        .maybeSingle();

    if (!template) {
        return NextResponse.json({ error: 'template_not_found' }, { status: 404 });
    }

    const context = await buildOrderContext(String(id));
    if (!context) {
        return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
    }

    // Подпись менеджера заказа — одна и та же во всех письмах клиенту.
    const { data: orderRow } = await supabase
        .from('orders')
        .select('manager_id')
        .eq('order_id', Number(id))
        .maybeSingle();
    const signature = await managerSignature((orderRow as any)?.manager_id ?? null);

    // Шаблон с заданием: письмо пишет ИИ под этот заказ, менеджер правит руками.
    if ((template as any).mode === 'ai') {
        if (!(template as any).prompt) {
            return NextResponse.json({ error: 'template_without_prompt' }, { status: 500 });
        }
        try {
            const letter = await writeLetter(String((template as any).prompt), context);
            const body = withSignature(letter.text, signature, false);
            return NextResponse.json({
                ok: true,
                name: template.name,
                subject: letter.subject,
                html: body.split('\n').map((line) => `<p>${line}</p>`).join(''),
                byAi: true,
            });
        } catch (e: any) {
            return NextResponse.json({ error: 'ai_failed', details: e.message }, { status: 502 });
        }
    }

    const subject = renderTemplate(template.subject, context);
    const body = renderTemplate(template.body, context);

    if (!subject.ok || !body.ok) {
        return NextResponse.json(
            { error: 'render_failed', details: subject.error || body.error },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        name: template.name,
        subject: subject.output,
        html: withSignature(body.output, signature, true),
    });
}
