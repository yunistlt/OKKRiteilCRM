/**
 * Полный текст письма — отдельным запросом, по щелчку.
 *
 * Список писем его больше не возит: двести писем с вёрсткой весили 6,2 МБ, и
 * раздел открывался секундами (жалоба владельца 05.10.2026 — «долго письма
 * загружаются»). В ленте показывается первая строка, а целиком письмо читают
 * по одному — его и грузим.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/** Текст из вёрстки: часть писем приходит вообще без текстовой части. */
function textFromHtml(html: unknown): string {
    return String(html ?? '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    // Идентификатор из ленты: «in-<id>» для входящих, «out-<id>» для исходящих.
    const raw = new URL(req.url).searchParams.get('id') ?? '';
    const incoming = raw.startsWith('in-');
    const id = raw.replace(/^(in|out|sent)-/, '');
    if (!id) return NextResponse.json({ error: 'Не передано письмо' }, { status: 400 });

    const { data } = incoming
        ? await supabase.from('incoming_emails').select('body_text, body_html').eq('id', id).maybeSingle()
        : await supabase.from('outgoing_emails').select('body_text, body_html').eq('id', id).maybeSingle();

    const row = data as any;
    if (!row) return NextResponse.json({ body: null });

    const plain = String(row.body_text ?? '').trim();
    return NextResponse.json({ body: plain || textFromHtml(row.body_html) || null });
}
