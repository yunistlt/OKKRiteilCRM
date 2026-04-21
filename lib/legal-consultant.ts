import type { AppRole } from '@/lib/auth';

export type LegalIntent = 'returns' | 'nda' | 'counterparty' | 'contracts' | 'escalation' | 'general';

export type LegalFallbackStrategy = 'kb_direct' | 'kb_ai' | 'needs_human' | 'out_of_scope';

export type LegalChatMessage = {
    role: 'user' | 'agent';
    text: string;
};

const LEGAL_INTENT_PATTERNS: Array<{ intent: LegalIntent; sectionKey: string; patterns: RegExp[] }> = [
    {
        intent: 'returns',
        sectionKey: 'returns',
        patterns: [/возврат/i, /претенз/i, /жалоб/i, /брак/i, /дефект/i],
    },
    {
        intent: 'nda',
        sectionKey: 'nda',
        patterns: [/nda/i, /конфиденц/i, /разглаш/i, /non[-\s]?disclosure/i],
    },
    {
        intent: 'counterparty',
        sectionKey: 'counterparty',
        patterns: [/контрагент/i, /инн/i, /банкрот/i, /суд/i, /провер/i],
    },
    {
        intent: 'contracts',
        sectionKey: 'contracts',
        patterns: [/договор/i, /протокол/i, /разноглас/i, /штраф/i, /подсуд/i, /редлайн/i],
    },
    {
        intent: 'escalation',
        sectionKey: 'escalation',
        patterns: [/эскалац/i, /юрист/i, /переда/i, /задач/i, /срочно/i],
    },
];

const HUMAN_ESCALATION_PATTERNS = [
    /суд/i,
    /иск/i,
    /штраф/i,
    /персональн/i,
    /подсуд/i,
    /комплаенс/i,
    /санкц/i,
    /миров/i,
    /арбитраж/i,
];

function maskValue(value: string, visibleTail: number = 4) {
    if (value.length <= visibleTail) return value;
    return `${'*'.repeat(Math.max(0, value.length - visibleTail))}${value.slice(-visibleTail)}`;
}

export function detectLegalIntent(question: string): { intent: LegalIntent; sectionKey: string | null } {
    for (const candidate of LEGAL_INTENT_PATTERNS) {
        if (candidate.patterns.some((pattern) => pattern.test(question))) {
            return { intent: candidate.intent, sectionKey: candidate.sectionKey };
        }
    }

    return { intent: 'general', sectionKey: null };
}

export function chooseLegalFallbackStrategy(question: string, knowledgeHitCount: number): LegalFallbackStrategy {
    if (knowledgeHitCount > 0 && process.env.OPENAI_API_KEY) {
        return 'kb_ai';
    }

    if (knowledgeHitCount > 0) {
        return 'kb_direct';
    }

    if (HUMAN_ESCALATION_PATTERNS.some((pattern) => pattern.test(question))) {
        return 'needs_human';
    }

    return 'out_of_scope';
}

export function summarizeLegalHistory(history: LegalChatMessage[]): string {
    if (history.length === 0) return 'Истории нет.';

    return history
        .slice(-6)
        .map((item) => `${item.role}: ${item.text}`)
        .join('\n');
}

export function sanitizeLegalContextForRole(
    role: AppRole,
    context: Record<string, any> | null | undefined,
): Record<string, any> {
    if (!context || typeof context !== 'object') {
        return {};
    }

    const sanitized: Record<string, any> = { ...context };

    if (typeof sanitized.counterpartyInn === 'string') {
        sanitized.counterpartyInn = role === 'admin' || role === 'rop' || role === 'okk'
            ? sanitized.counterpartyInn
            : maskValue(sanitized.counterpartyInn, 4);
    }

    if (role === 'manager') {
        delete sanitized.internalApprovalThreshold;
        delete sanitized.internalNotes;
        delete sanitized.penaltyMatrix;
    }

    return sanitized;
}

export function canSeeLegalAudience(role: AppRole, audience: unknown): boolean {
    if (audience === 'all' || !audience) return true;
    if (audience === 'supervisor') return role === 'admin' || role === 'rop' || role === 'okk';
    return role === 'admin';
}

export function buildLegalDirectAnswer(params: {
    question: string;
    fallbackStrategy: LegalFallbackStrategy;
    hit?: { title: string; content: string; source_ref?: string | null } | null;
}): string {
    const { fallbackStrategy, hit } = params;

    if (hit) {
        return [
            `${hit.title}.`,
            hit.content,
            hit.source_ref ? `Источник: ${hit.source_ref}.` : '',
        ].filter(Boolean).join('\n');
    }

    if (fallbackStrategy === 'needs_human') {
        return 'Нужна ручная эскалация юристу. В базе знаний нет безопасного готового ответа для такого кейса.';
    }

    return 'Не знаю. В базе знаний нет подтвержденного ответа для этого вопроса, лучше создать задачу юристу.';
}