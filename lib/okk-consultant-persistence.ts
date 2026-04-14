const CONSULTANT_PERSISTENCE_TABLES = [
    'okk_consultant_threads',
    'okk_consultant_messages',
    'okk_consultant_logs',
];

function normalizeErrorText(value: unknown): string {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

export function isMissingConsultantPersistenceError(error: any): boolean {
    const code = normalizeErrorText(error?.code);
    const message = normalizeErrorText(error?.message);
    const details = normalizeErrorText(error?.details);
    const hint = normalizeErrorText(error?.hint);
    const payload = [message, details, hint].filter(Boolean).join(' ');

    if (code === '42p01' || code === 'pgrst116' || code === 'pgrst205') {
        return true;
    }

    if (payload.includes('schema cache') && payload.includes('okk_consultant')) {
        return true;
    }

    if (payload.includes('relation') && payload.includes('okk_consultant')) {
        return true;
    }

    return CONSULTANT_PERSISTENCE_TABLES.some((table) => payload.includes(table));
}
