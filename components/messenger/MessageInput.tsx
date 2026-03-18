'use client';

import React, { useState, useRef } from 'react';

interface MessageInputProps {
    chatId: string;
    onMessageSent?: () => void;
}

export default function MessageInput({ chatId, onMessageSent }: MessageInputProps) {
    const [content, setContent] = useState('');
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if ((!content.trim() && !uploading) || sending) return;

        setSending(true);
        try {
            const res = await fetch('/api/messenger/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    content: content.trim()
                })
            });

            if (res.ok) {
                setContent('');
                onMessageSent?.();
            }
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setSending(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const urlRes = await fetch('/api/messenger/attachments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    file_name: file.name,
                    file_type: file.type
                })
            });
            const { upload_url, file_path } = await urlRes.json();

            const uploadRes = await fetch(upload_url, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type }
            });

            if (!uploadRes.ok) throw new Error('Upload failed');

            await fetch('/api/messenger/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    content: `Загружен файл: ${file.name}`,
                    attachments: [{
                        name: file.name,
                        path: file_path,
                        type: file.type,
                        size: file.size,
                        url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/chat-attachments/${file_path}`
                    }]
                })
            });
            onMessageSent?.();
        } catch (error) {
            console.error('File upload failed:', error);
            alert('Ошибка при загрузке файла');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const canSend = content.trim().length > 0 && !sending;

    return (
        <div style={{
            background: '#f0f0f0',
            borderTop: '1px solid #ddd',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8
        }}>
            <input
                type="file"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
            />

            {/* Attach button */}
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '50%',
                    color: uploading ? '#4fa3e3' : '#8b9499',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginBottom: 2,
                    transition: 'color 0.15s'
                }}
                title="Прикрепить файл"
            >
                {uploading ? (
                    <div style={{
                        width: 22,
                        height: 22,
                        border: '2px solid #4fa3e3',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite'
                    }} />
                ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                )}
            </button>

            {/* Text input */}
            <div style={{ flex: 1, position: 'relative' }}>
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
                    style={{
                        width: '100%',
                        padding: '9px 14px',
                        background: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: 22,
                        outline: 'none',
                        fontSize: 14,
                        color: '#111',
                        resize: 'none',
                        lineHeight: 1.45,
                        maxHeight: 120,
                        overflowY: 'auto',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                        transition: 'border-color 0.15s',
                        display: 'block',
                        boxSizing: 'border-box'
                    }}
                    onFocus={(e) => { e.target.style.borderColor = '#4fa3e3'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#ddd'; }}
                />
            </div>

            {/* Send button — Telegram blue circle */}
            <button
                type="button"
                onClick={() => handleSend()}
                disabled={!canSend}
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: canSend ? '#2ca5e0' : '#c5d8e6',
                    border: 'none',
                    cursor: canSend ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginBottom: 1,
                    transition: 'background 0.15s',
                    boxShadow: canSend ? '0 2px 6px rgba(44,165,224,0.4)' : 'none'
                }}
            >
                {sending ? (
                    <div style={{
                        width: 18,
                        height: 18,
                        border: '2px solid #fff',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite'
                    }} />
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 2 }}>
                        <path d="M22 2L11 13" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                )}
            </button>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}
