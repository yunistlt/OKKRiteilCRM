'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/utils/supabase';

interface Session {
    id: string;
    visitor_id: string;
    domain: string;
    geo_city: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    referrer: string | null;
    landing_page: string | null;
    is_human_takeover: boolean;
    interested_products: string[] | null;
    created_at: string;
    user_agent: string | null;
}

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    created_at: string;
}

interface Event {
    id: string;
    event_type: string;
    url: string;
    page_title: string;
    created_at: string;
}

export default function LeadCatcherPage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [events, setEvents] = useState<Event[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 1. Fetch Sessions
    useEffect(() => {
        const fetchSessions = async () => {
            const { data, error } = await supabase
                .from('widget_sessions')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (data) setSessions(data);
            setLoading(false);
        };

        fetchSessions();

        // Realtime sessions
        const channel = supabase.channel('sessions-channel')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'widget_sessions' }, () => {
                fetchSessions();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    // 2. Fetch Messages and Events for selected session
    useEffect(() => {
        if (!selectedSessionId) return;

        const fetchData = async () => {
            const [msgRes, evtRes] = await Promise.all([
                supabase.from('widget_messages').select('*').eq('session_id', selectedSessionId).order('created_at', { ascending: true }),
                supabase.from('widget_events').select('*').eq('session_id', selectedSessionId).order('created_at', { ascending: false })
            ]);

            if (msgRes.data) setMessages(msgRes.data);
            if (evtRes.data) setEvents(evtRes.data);
        };

        fetchData();

        // Realtime messages
        const channel = supabase.channel(`messages-${selectedSessionId}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'widget_messages', 
                filter: `session_id=eq.${selectedSessionId}` 
            }, (payload: any) => {
                setMessages(prev => [...prev, payload.new as Message]);
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'widget_events',
                filter: `session_id=eq.${selectedSessionId}`
            }, (payload: any) => {
                setEvents(prev => [payload.new as Event, ...prev]);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [selectedSessionId]);

    // Scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !selectedSessionId || sending) return;

        setSending(true);
        const { error } = await supabase.from('widget_messages').insert({
            session_id: selectedSessionId,
            role: 'assistant',
            content: input
        });

        if (!error) setInput('');
        setSending(false);
    };

    const toggleTakeover = async (sessionId: string, current: boolean) => {
        await supabase.from('widget_sessions').update({ is_human_takeover: !current }).eq('id', sessionId);
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, is_human_takeover: !current } : s));
    };

    const selectedSession = sessions.find(s => s.id === selectedSessionId);

    return (
        <div className="flex h-[calc(100vh-80px)] bg-gray-50 overflow-hidden font-sans">
            {/* Sidebar: Visitors */}
            <div className="w-80 border-r bg-white flex flex-col shadow-sm">
                <div className="p-6 border-b">
                    <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                        <span className="text-red-500 animate-pulse">●</span> Ловец Лидов
                    </h1>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Активные посетители</p>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="p-10 text-center text-gray-400 animate-pulse">Загрузка...</div>
                    ) : sessions.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 italic">Пока никого нет...</div>
                    ) : (
                        sessions.map(s => (
                            <div 
                                key={s.id} 
                                onClick={() => setSelectedSessionId(s.id)}
                                className={`p-4 border-b cursor-pointer transition-all hover:bg-gray-50 relative ${selectedSessionId === s.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-xs font-black text-gray-900 truncate max-w-[150px]">
                                        {s.geo_city || 'Неизвестный город'}
                                    </span>
                                    {s.is_human_takeover && (
                                        <span className="bg-orange-100 text-orange-600 text-[8px] font-black uppercase px-1.5 py-0.5 rounded shadow-sm">Кожа</span>
                                    )}
                                </div>
                                <div className="text-[10px] text-gray-400 truncate">{s.landing_page}</div>
                                <div className="flex gap-1 mt-2">
                                    {s.utm_source && <span className="bg-gray-100 text-gray-500 text-[8px] px-1 py-0.5 rounded">{s.utm_source}</span>}
                                    <span className="text-[8px] text-gray-300 ml-auto">{new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Area: Chat & Info */}
            <div className="flex-1 flex flex-col relative">
                {selectedSession ? (
                    <>
                        {/* Header */}
                        <div className="p-6 bg-white border-b flex justify-between items-center shadow-sm z-10">
                            <div>
                                <div className="flex items-center gap-3">
                                    <h2 className="text-xl font-black text-gray-900">Сессия {selectedSession.visitor_id.slice(-6)}</h2>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${selectedSession.is_human_takeover ? 'bg-orange-500 text-white' : 'bg-green-500 text-white'}`}>
                                        {selectedSession.is_human_takeover ? 'Ручное управление' : 'ИИ-Консультант'}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">Откуда: {selectedSession.referrer || 'Прямой заход'}</p>
                            </div>
                            
                            <button 
                                onClick={() => toggleTakeover(selectedSession.id, selectedSession.is_human_takeover)}
                                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-95 ${
                                    selectedSession.is_human_takeover 
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200 shadow-green-100' 
                                    : 'bg-orange-600 text-white hover:bg-orange-700 shadow-orange-200'
                                }`}
                            >
                                {selectedSession.is_human_takeover ? 'Вернуть ИИ' : 'Взять управление'}
                            </button>
                        </div>

                        <div className="flex-1 flex overflow-hidden">
                            {/* Chat Window */}
                            <div className="flex-1 flex flex-col bg-white">
                                <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
                                    {messages.map(m => (
                                        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                                            <div className={`max-w-[70%] p-4 rounded-3xl text-sm shadow-sm ${
                                                m.role === 'user' 
                                                ? 'bg-white text-gray-800 border border-gray-100 rounded-bl-none' 
                                                : m.role === 'assistant' 
                                                    ? 'bg-blue-600 text-white rounded-br-none'
                                                    : 'bg-gray-200 text-gray-500 text-[10px] italic py-1'
                                            }`}>
                                                {m.content}
                                                <div className={`text-[8px] mt-1 opacity-50 text-right ${m.role === 'assistant' ? 'text-blue-100' : 'text-gray-400'}`}>
                                                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Input */}
                                <form onSubmit={handleSend} className="p-6 border-t bg-white flex gap-4 items-center">
                                    <input 
                                        type="text" 
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        placeholder={selectedSession.is_human_takeover ? "Введите сообщение..." : "Сначала возьмите управление на себя"}
                                        disabled={!selectedSession.is_human_takeover || sending}
                                        className="flex-1 bg-gray-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                                    />
                                    <button 
                                        type="submit" 
                                        disabled={!selectedSession.is_human_takeover || !input.trim() || sending}
                                        className="bg-blue-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-95"
                                    >
                                        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"></path></svg>
                                    </button>
                                </form>
                            </div>

                            {/* Footprint Sidebar */}
                            <div className="w-80 border-l bg-white p-6 overflow-y-auto space-y-8">
                                <div>
                                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Детали сессии</h3>
                                    <div className="bg-gray-50 rounded-2xl p-4 space-y-3 mb-8">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-gray-400 uppercase">Источник</span>
                                            <span className="text-xs font-bold text-gray-700">{selectedSession.utm_source || 'Organic / Direct'}</span>
                                        </div>
                                        {selectedSession.utm_campaign && (
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black text-gray-400 uppercase">Кампания</span>
                                                <span className="text-xs font-bold text-gray-700">{selectedSession.utm_campaign}</span>
                                            </div>
                                        )}
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-gray-400 uppercase">Посадочная</span>
                                            <span className="text-[10px] font-medium text-gray-500 break-all">{selectedSession.landing_page}</span>
                                        </div>
                                    </div>

                                    {selectedSession.interested_products && selectedSession.interested_products.length > 0 && (
                                        <div className="mb-8">
                                            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span> 🔥 Интересы (Товары)
                                            </h3>
                                            <div className="flex flex-wrap gap-2">
                                                {selectedSession.interested_products.map((p, idx) => (
                                                    <span key={idx} className="bg-blue-50 text-blue-700 text-[10px] font-bold px-3 py-1.5 rounded-xl border border-blue-100 shadow-sm">
                                                        {p}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Цифровой след</h3>
                                    <div className="space-y-4">
                                        {events.map(e => (
                                            <div key={e.id} className="relative pl-4 border-l-2 border-gray-100">
                                                <div className="absolute -left-[5px] top-0 w-2 h-2 bg-gray-200 rounded-full"></div>
                                                <p className="text-xs font-bold text-gray-700 leading-tight">{e.page_title}</p>
                                                <p className="text-[10px] text-gray-400 truncate">{e.url}</p>
                                                <p className="text-[8px] text-gray-300 mt-1">{new Date(e.created_at).toLocaleTimeString()}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <div className="text-6xl mb-4">🎯</div>
                        <p className="font-bold uppercase tracking-widest text-sm">Выберите посетителя для слежки</p>
                    </div>
                )}
            </div>
        </div>
    );
}
