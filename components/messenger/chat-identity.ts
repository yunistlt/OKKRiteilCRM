import type { MessengerChat, MessengerParticipant } from './types';

export function getInitials(first?: string | null, last?: string | null, fallback?: string | null) {
    const initials = `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase();
    if (initials) {
        return initials;
    }

    const normalizedFallback = (fallback || '').trim();
    return normalizedFallback.slice(0, 2).toUpperCase() || '?';
}

export function getChatDisplayName(chat: MessengerChat | undefined, currentUserId?: number) {
    if (!chat) {
        return undefined;
    }

    if (chat.type !== 'direct') {
        return chat.name || 'Чат';
    }

    const otherParticipant = chat.chat_participants?.find((participant: MessengerParticipant) => participant.user_id !== currentUserId);
    const firstName = otherParticipant?.managers?.first_name || '';
    const lastName = otherParticipant?.managers?.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || chat.name || 'Личный чат';
}

export function getChatAvatarUrl(chat: MessengerChat | undefined, currentUserId?: number) {
    if (!chat) {
        return null;
    }

    if (chat.type === 'group') {
        return chat.avatar_url || null;
    }

    const otherParticipant = chat.chat_participants?.find((participant: MessengerParticipant) => participant.user_id !== currentUserId);
    return otherParticipant?.managers?.avatar_url || null;
}