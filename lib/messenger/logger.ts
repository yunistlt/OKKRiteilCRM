type MessengerErrorScope =
    | 'attachments.get'
    | 'attachments.post'
    | 'bot.sendSystemMessage'
    | 'chats.create'
    | 'chats.delete'
    | 'chats.get'
    | 'chats.markRead'
    | 'chats.rename'
    | 'members.delete'
    | 'members.get'
    | 'members.post'
    | 'push.delete'
    | 'push.dispatch'
    | 'push.get'
    | 'push.presence'
    | 'push.post'
    | 'messages.delete'
    | 'messages.get'
    | 'messages.post';

type MessengerMetricName = 'messenger.error';

type MessengerLogContext = {
    userId?: number | null;
    chatId?: string | null;
    messageId?: string | null;
    method?: string;
    details?: Record<string, unknown>;
};

function normalizeError(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    if (typeof error === 'object' && error !== null) {
        const candidate = error as Record<string, unknown>;
        return {
            name: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
            message: typeof candidate.message === 'string' ? candidate.message : JSON.stringify(candidate),
            stack: typeof candidate.stack === 'string' ? candidate.stack : undefined,
            code: typeof candidate.code === 'string' ? candidate.code : undefined,
        };
    }

    return {
        name: 'UnknownError',
        message: String(error),
        stack: undefined,
    };
}

function emitMessengerMetric(metric: MessengerMetricName, scope: MessengerErrorScope, context: MessengerLogContext, errorInfo: ReturnType<typeof normalizeError>) {
    console.info('[MessengerMetric]', {
        timestamp: new Date().toISOString(),
        metric,
        scope,
        userId: context.userId ?? null,
        chatId: context.chatId ?? null,
        messageId: context.messageId ?? null,
        method: context.method ?? null,
        code: 'code' in errorInfo ? errorInfo.code : undefined,
    });
}

export function logMessengerError(scope: MessengerErrorScope, error: unknown, context: MessengerLogContext = {}) {
    const errorInfo = normalizeError(error);

    console.error('[MessengerError]', {
        timestamp: new Date().toISOString(),
        scope,
        userId: context.userId ?? null,
        chatId: context.chatId ?? null,
        messageId: context.messageId ?? null,
        method: context.method ?? null,
        details: context.details ?? null,
        error: errorInfo,
    });

    emitMessengerMetric('messenger.error', scope, context, errorInfo);
}