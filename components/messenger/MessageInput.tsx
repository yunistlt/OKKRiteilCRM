'use client';

import React, { useState, useRef } from 'react';
import { uploadFileToSignedStorageUrl } from '@/lib/supabase-browser';

export interface PendingMessageDraft {
    localId: string;
    content: string;
    attachments?: Array<{
        name: string;
        path?: string;
        type: string;
        size: number;
    }>;
}

interface MessageInputProps {
    chatId: string;
    onMessageSent?: () => void;
    onPendingMessageCreated?: (draft: PendingMessageDraft) => void;
    onPendingMessageStatusChange?: (localId: string, status: 'sending' | 'failed') => void;
    onPendingMessageResolved?: (localId: string) => void;
}

function createPendingMessageDraft(content: string, attachments?: PendingMessageDraft['attachments']): PendingMessageDraft {
    return {
        localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        attachments,
    };
}

export default function MessageInput({
    chatId,
    onMessageSent,
    onPendingMessageCreated,
    onPendingMessageStatusChange,
    onPendingMessageResolved,
}: MessageInputProps) {
    const [content, setContent] = useState('');
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if ((!content.trim() && !uploading) || sending) return;

        const trimmedContent = content.trim();
        const draft = createPendingMessageDraft(trimmedContent);
        onPendingMessageCreated?.(draft);
        setSending(true);
        try {
            const res = await fetch('/api/messenger/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    content: trimmedContent
                })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || 'Не удалось отправить сообщение');
            }

            setContent('');
            onPendingMessageResolved?.(draft.localId);
            onMessageSent?.();
        } catch (error) {
            console.error('Failed to send message:', error);
            onPendingMessageStatusChange?.(draft.localId, 'failed');
        } finally {
            setSending(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const fileMessage = `Загружен файл: ${file.name}`;
        const draft = createPendingMessageDraft(fileMessage, [{
            name: file.name,
            type: file.type,
            size: file.size,
        }]);
        onPendingMessageCreated?.(draft);
        setUploading(true);
        try {
            const urlRes = await fetch('/api/messenger/attachments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    file_name: file.name,
                    file_type: file.type,
                    file_size: file.size,
                })
            });
            if (!urlRes.ok) {
                const data = await urlRes.json().catch(() => null);
                throw new Error(data?.error || 'Не удалось подготовить загрузку файла');
            }
            const { file_path, token } = await urlRes.json();

            await uploadFileToSignedStorageUrl({
                bucket: 'chat-attachments',
                filePath: file_path,
                token,
                file,
            });

            const sendRes = await fetch('/api/messenger/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    content: fileMessage,
                    attachments: [{
                        name: file.name,
                        path: file_path,
                        type: file.type,
                        size: file.size,
                    }]
                })
            });

            if (!sendRes.ok) {
                const data = await sendRes.json().catch(() => null);
                throw new Error(data?.error || 'Не удалось отправить сообщение с файлом');
            }

            onPendingMessageResolved?.(draft.localId);
            onMessageSent?.();
        } catch (error) {
            console.error('File upload failed:', error);
            onPendingMessageStatusChange?.(draft.localId, 'failed');
            alert('Ошибка при загрузке файла');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const canSend = content.trim().length > 0 && !sending;

    return (
        <div className="shrink-0 border-t border-slate-200 bg-white/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-sm">
            <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm">
            <input
                type="file"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
            />

            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mb-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-sky-300 hover:text-sky-600 disabled:cursor-default disabled:opacity-70"
                title="Прикрепить файл"
            >
                {uploading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                )}
            </button>

            <div className="relative flex-1">
                <textarea
                    rows={1}
                    value={content}
                    onChange={(e) => {
                        setContent(e.target.value);
                        // Auto-resize
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder="Сообщение"
                    className="block max-h-[120px] w-full resize-none rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                />
            </div>

            <button
                type="button"
                onClick={() => handleSend()}
                disabled={!canSend}
                className="mb-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg shadow-sky-200 transition hover:bg-sky-700 disabled:cursor-default disabled:bg-slate-300 disabled:shadow-none"
            >
                {sending ? (
                    <div className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 2 }}>
                        <path d="M22 2L11 13" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                )}
            </button>
            </div>
        </div>
    );
}
