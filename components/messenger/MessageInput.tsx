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
            // 1. Get signed URL
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

            // 2. Upload to Storage
            const uploadRes = await fetch(upload_url, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type }
            });

            if (!uploadRes.ok) throw new Error('Upload failed');

            // 3. Send message with attachment
            // Note: In a real app, we'd construct the public URL or use a proxy
            // Here we'll just save the path and metadata
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

        } catch (error) {
            console.error('File upload failed:', error);
            alert('Ошибка при загрузке файла');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="p-4 border-t bg-white">
            <form onSubmit={handleSend} className="flex items-end gap-2">
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
                    className="mb-1 p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors disabled:opacity-50"
                >
                    {uploading ? (
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent animate-spin rounded-full" />
                    ) : (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                    )}
                </button>

                <div className="flex-1 relative">
                    <textarea
                        rows={1}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Напишите сообщение..."
                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none max-h-32 text-gray-800"
                    />
                </div>

                <button
                    type="submit"
                    disabled={!content.trim() || sending}
                    className="mb-1 p-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:bg-gray-300 shadow-sm shadow-blue-200"
                >
                    {sending ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                    ) : (
                        <svg className="w-6 h-6 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    )}
                </button>
            </form>
        </div>
    );
}
