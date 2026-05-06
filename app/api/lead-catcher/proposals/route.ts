import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { generateProposalPDF, ProposalData } from '@/lib/pdf-generator';
import { getOpenAIClient } from '@/utils/openai';

export const dynamic = 'force-dynamic';

// ── GET: список КП по session_id ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(req.url);
        const sessionId = searchParams.get('session_id');
        if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

        const { data, error } = await supabase
            .from('lead_proposals')
            .select('id, title, status, token, pdf_url, viewed_at, sent_at, created_at, discount_pct, valid_until')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return NextResponse.json({ proposals: data });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// ── POST: создать новое КП ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const managerSession = await getSession(req);
        if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json();
        const { session_id, title, items, discount_pct = 0, valid_until, generate_intro } = body;

        if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'items required' }, { status: 400 });
        }

        // Опционально: AI-генерация введения на основе диалога
        let intro: string | null = null;
        if (generate_intro) {
            try {
                const { data: msgs } = await supabase
                    .from('widget_messages')
                    .select('role, content')
                    .eq('session_id', session_id)
                    .order('created_at', { ascending: true })
                    .limit(20);

                if (msgs && msgs.length > 0) {
                    const openai = getOpenAIClient();
                    const log = msgs.map((m: any) => `${m.role === 'user' ? 'Клиент' : 'Елена'}: ${m.content}`).join('\n');
                    const resp = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: 'Ты — менеджер завода ЗМК. На основе диалога напиши вступительный абзац для коммерческого предложения (2-3 предложения). Стиль: деловой, тёплый, без воды. Не упоминай, что это ИИ-ответ.',
                            },
                            { role: 'user', content: `Диалог:\n${log}\n\nТовары в КП: ${items.map((i: any) => i.name).join(', ')}` },
                        ],
                        max_tokens: 200,
                    });
                    intro = resp.choices[0]?.message?.content?.trim() || null;
                }
            } catch (e) {
                console.error('[proposals] AI intro error:', e);
            }
        }

        // Сохраняем КП в Supabase
        const { data: proposal, error: insertErr } = await supabase
            .from('lead_proposals')
            .insert({
                session_id,
                title: title || 'Коммерческое предложение',
                intro,
                items,
                discount_pct,
                valid_until: valid_until || null,
                status: 'draft',
                created_by: managerSession.user.email,
            })
            .select('*')
            .single();

        if (insertErr) throw insertErr;

        // Генерируем PDF
        try {
            // Данные клиента из сессии
            const { data: widgetSession } = await supabase
                .from('widget_sessions')
                .select('nickname, contact_name, contact_company')
                .eq('id', session_id)
                .single();

            const pdfData: ProposalData = {
                title: proposal.title,
                intro: proposal.intro || undefined,
                items,
                discount_pct,
                valid_until: valid_until || undefined,
                client_name: (widgetSession as any)?.contact_name || (widgetSession as any)?.nickname || undefined,
                client_company: (widgetSession as any)?.contact_company || undefined,
            };

            const pdfBuffer = await generateProposalPDF(pdfData);
            const fileName = `proposals/${proposal.token}.pdf`;

            const { data: uploadData, error: uploadErr } = await supabase.storage
                .from('okk-assets')
                .upload(fileName, pdfBuffer, {
                    contentType: 'application/pdf',
                    upsert: true,
                });

            if (!uploadErr) {
                const { data: urlData } = supabase.storage.from('okk-assets').getPublicUrl(fileName);
                await supabase
                    .from('lead_proposals')
                    .update({ pdf_url: urlData.publicUrl })
                    .eq('id', proposal.id);
                proposal.pdf_url = urlData.publicUrl;
            } else {
                console.error('[proposals] PDF upload error:', uploadErr);
            }
        } catch (pdfErr) {
            console.error('[proposals] PDF generation error:', pdfErr);
            // Не блокируем создание КП
        }

        const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://okk.zmksoft.com'}/lead-catcher/proposal/${proposal.token}`;

        return NextResponse.json({
            success: true,
            proposal: { ...proposal, public_url: publicUrl },
        });
    } catch (e: any) {
        console.error('[proposals] POST error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
