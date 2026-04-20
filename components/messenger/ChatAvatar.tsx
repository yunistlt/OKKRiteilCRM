'use client';

import React from 'react';
import { resolveMessengerAvatarSrc } from '@/lib/messenger/avatar';
import { getInitials } from './chat-identity';

export default function ChatAvatar({
    avatarUrl,
    firstName,
    lastName,
    fallback,
    type = 'direct',
    sizeClass = 'h-12 w-12',
    textClass = 'text-sm',
}: {
    avatarUrl?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fallback?: string | null;
    type?: 'direct' | 'group';
    sizeClass?: string;
    textClass?: string;
}) {
    const resolvedAvatarSrc = resolveMessengerAvatarSrc(avatarUrl);

    if (resolvedAvatarSrc) {
        return (
            <div className={`overflow-hidden rounded-full ${sizeClass}`}>
                <img src={resolvedAvatarSrc} alt={fallback || 'Аватар'} className="h-full w-full object-cover" />
            </div>
        );
    }

    return (
        <div className={`flex flex-shrink-0 items-center justify-center rounded-full font-bold ${sizeClass} ${textClass} ${type === 'group' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
            {getInitials(firstName, lastName, fallback)}
        </div>
    );
}