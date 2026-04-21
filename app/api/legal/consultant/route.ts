import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
    buildLegalDirectAnswer,
    chooseLegalFallbackStrategy,
    detectLegalIntent,
    sanitizeLegalContextForRole,
    summarizeLegalHistory,
    type LegalChatMessage,
} from '@/lib/legal-consultant';
import {
    formatLegalKnowledgeContext,
    getLegalPromptConfig,
    renderLegalTemplate,
    searchLegalKnowledge,
} from '@/lib/legal-consultant-ai';
import { getOpenAIClient } from '@/utils/openai';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RequestBody = {
    message?: string;
    history?: LegalChatMessage[];
    context?: Record<string, any> | null;
};

async function logLegalAudit(payload: Record<string, any>) {
    try {
        await supabase.from('legal_audit_log').insert(payload);
    } catch (error) {
        console.warn('[Legal Consultant] Failed to write audit log.', error);
    }
}

export async function POST(request: Request) {
    const session = await getSession();

    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as RequestBody;
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

    if (!message) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const { intent, sectionKey } = detectLegalIntent(message);
    const sanitizedContext = sanitizeLegalContextForRole(session.user.role, body.context || null);
    const knowledgeHits = await searchLegalKnowledge(message, session.user.role, sectionKey);
    const fallbackStrategy = chooseLegalFallbackStrategy(message, knowledgeHits.length);

    let answer = buildLegalDirectAnswer({
        question: message,
        fallbackStrategy,
        hit: knowledgeHits[0] || null,
    });
    let usedAiFallback = false;

    if (fallbackStrategy === 'kb_ai' && process.env.OPENAI_API_KEY) {
        try {
            const [mainPrompt, stylePrompt] = await Promise.all([
                getLegalPromptConfig('legal_consultant_main_chat'),
                getLegalPromptConfig('legal_consultant_style_guardrail'),
            ]);
            const openai = getOpenAIClient();
            const prompt = renderLegalTemplate(mainPrompt.userPromptTemplate, {
                question: message,
                intent,
                section_title: sectionKey || 'general',
                fallback_strategy: fallbackStrategy,
                knowledge_context: formatLegalKnowledgeContext(knowledgeHits),
                history_context: summarizeLegalHistory(history),
                sanitized_context: JSON.stringify(sanitizedContext, null, 2),
            });

            const completion = await openai.chat.completions.create({
                model: mainPrompt.model,
                temperature: mainPrompt.temperature,
                max_tokens: mainPrompt.maxTokens,
                messages: [
                    {
                        role: 'system',
                        content: `${mainPrompt.systemPrompt}\n\n${stylePrompt.systemPrompt}`,
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            });

            const aiAnswer = completion.choices[0]?.message?.content?.trim();
            if (aiAnswer) {
                answer = aiAnswer;
                usedAiFallback = true;
            }
        } catch (error) {
            console.warn('[Legal Consultant] AI fallback failed, using direct KB answer.', error);
        }
    }

    const shouldEscalate = fallbackStrategy === 'needs_human' || fallbackStrategy === 'out_of_scope';

    await logLegalAudit({
        action: 'legal_consultant_chat',
        entity: 'legal_consultant',
        performed_by: session.user.id,
        details: {
            intent,
            sectionKey,
            fallbackStrategy,
            usedAiFallback,
            message,
            knowledgeHits: knowledgeHits.map((item) => ({
                slug: item.slug,
                similarity: item.similarity,
            })),
        },
    });

    return NextResponse.json({
        answer,
        intent,
        sectionKey,
        fallbackStrategy,
        usedAiFallback,
        shouldEscalate,
        knowledgeHits: knowledgeHits.map((item) => ({
            slug: item.slug,
            title: item.title,
            type: item.type,
            similarity: item.similarity,
        })),
        sanitizedContext,
    });
}