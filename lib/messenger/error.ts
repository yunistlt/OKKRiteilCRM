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