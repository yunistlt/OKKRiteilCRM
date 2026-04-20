export function getMessengerErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error) {
        return error.message || fallback;
    }

    if (typeof error === 'object' && error !== null) {
        const candidate = error as Record<string, unknown>;

        if (typeof candidate.error === 'string' && candidate.error.trim().length > 0) {
            return candidate.error;
        }

        if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
            return candidate.message;
        }
    }

    if (typeof error === 'string' && error.trim().length > 0) {
        return error;
    }

    return fallback;
}

function normalizeErrorText(value: unknown): string {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

export function isMissingMessengerRelationError(error: unknown, relationNames: string | string[]) {
    const candidate = (typeof error === 'object' && error !== null) ? error as Record<string, unknown> : {};
    const relations = Array.isArray(relationNames) ? relationNames : [relationNames];
    const normalizedRelations = relations.map((relation) => relation.toLowerCase());

    const code = normalizeErrorText(candidate.code);
    const message = normalizeErrorText(candidate.message);
    const details = normalizeErrorText(candidate.details);
    const hint = normalizeErrorText(candidate.hint);
    const payload = [message, details, hint].filter(Boolean).join(' ');

    if (code === '42p01' || code === 'pgrst116' || code === 'pgrst205') {
        return true;
    }

    if (payload.includes('schema cache')) {
        return normalizedRelations.some((relation) => payload.includes(relation));
    }

    if (payload.includes('relation') && payload.includes('does not exist')) {
        return normalizedRelations.some((relation) => payload.includes(relation));
    }

    return normalizedRelations.some((relation) => payload.includes(relation));
}