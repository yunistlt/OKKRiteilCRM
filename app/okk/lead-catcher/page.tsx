'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/utils/supabase';

interface Session {
    id: string;
    visitor_id: string;
    nickname: string | null;
    domain: string;
    geo_city: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    referrer: string | null;
    landing_page: string | null;
    is_human_takeover: boolean;
    interested_products: string[] | null;
    manager_notes: string | null;
    user_agent: string | null;
    created_at: string;
    last_message?: string; // New field for UI
    last_message_time?: string;
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
    const [notes, setNotes] = useState('');
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 1. Fetch Sessions with last message preview
    const fetchSessions = async () => {
        // Fetch sessions
        const { data: sessData } = await supabase
            .from('widget_sessions')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (sessData) {
            // For each session, get the latest message
            const sessionsWithPreview = await Promise.all(sessData.map(async (s) => {
                const { data: lastMsg } = await supabase
                    .from('widget_messages')
                    .select('content, created_at')
                    .eq('session_id', s.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();
                
                return {
                    ...s,
                    last_message: lastMsg?.content || null,
                    last_message_time: lastMsg?.created_at || s.created_at
                };
            }));

            // Sort by last activity (message time or session creation time)
            const sorted = sessionsWithPreview.sort((a, b) => 
                new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
            );

            setSessions(sorted);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchSessions();

        const channel = supabase.channel('global-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'widget_sessions' }, () => {
                fetchSessions();
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'widget_messages' }, () => {
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
            
            const currentSession = sessions.find(s => s.id === selectedSessionId);
            if (currentSession) setNotes(currentSession.manager_notes || '');
        };

        fetchData();

        const channel = supabase.channel(`session-detail-${selectedSessionId}`)
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

    const saveNotes = async () => {
        if (!selectedSessionId) return;
        await supabase.from('widget_sessions').update({ manager_notes: notes }).eq('id', selectedSessionId);
        setSessions(prev => prev.map(s => s.id === selectedSessionId ? { ...s, manager_notes: notes } : s));
    };

    const toggleTakeover = async (sessionId: string, current: boolean) => {
        await supabase.from('widget_sessions').update({ is_human_takeover: !current }).eq('id', sessionId);
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, is_human_takeover: !current } : s));
    };

    const selectedSession = sessions.find(s => s.id === selectedSessionId);

    const getInitials = (name: string | null) => {
        if (!name) return '??';
        return name.split(' ').map(n => n[0]).join('').slice(-2).toUpperCase();
    };

    return (
        <div className="flex h-[calc(100vh-80px)] bg-gray-100 overflow-hidden font-sans">
            {/* Lead List Sidebar */}
            <div className="w-96 border-r bg-white flex flex-col shadow-lg z-20">
                <div className="p-6 border-b bg-gray-900 text-white">
                    <h1 className="text-xl font-black flex items-center gap-2">
                        <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]"></span> 
                        Ловец Лидов
                    </h1>
                    <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Активно: {sessions.length}</span>
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {loading ? (
                        <div className="p-10 text-center text-gray-300 animate-pulse font-bold uppercase text-[10px]">Синхронизация...</div>
                    ) : sessions.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 italic text-sm">Нет активных сессий</div>
                    ) : (
                        sessions.map(s => (
                            <div 
                                key={s.id} 
                                onClick={() => setSelectedSessionId(s.id)}
                                className={`p-4 border-b cursor-pointer transition-all hover:bg-blue-50/50 relative group ${selectedSessionId === s.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className={`w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center text-xs font-black shadow-sm ${selectedSessionId === s.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                        {getInitials(s.nickname)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-sm font-black text-gray-900 truncate">{s.nickname || 'Аноним'}</span>
                                            <span className="text-[8px] text-gray-400 font-bold">{new Date(s.last_message_time || s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <div className="text-[11px] text-blue-600 font-black truncate">
                                            {s.last_message ? (
                                                <span className="text-gray-500 font-medium">💬 {s.last_message}</span>
                                            ) : (
                                                <span className="text-gray-300 font-normal italic">Нет сообщений</span>
                                            )}
                                        </div>
                                        <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-1">
                                            <span>📍 {s.geo_city || 'Неизвестно'}</span>
                                            <span>•</span>
                                            <span>{s.domain}</span>
                                        </div>
                                    </div>
                                    {s.is_human_takeover && (
                                        <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0 mt-1"></div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative bg-white">
                {selectedSession ? (
                    <>
                        {/* Session Header */}
                        <div className="px-8 py-6 border-b flex justify-between items-center bg-white/80 backdrop-blur-md z-10 sticky top-0">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-3xl bg-gray-900 text-white flex items-center justify-center text-lg font-black">
                                    {getInitials(selectedSession.nickname)}
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                                        {selectedSession.nickname}
                                        {selectedSession.is_human_takeover && (
                                            <span className="bg-orange-100 text-orange-600 text-[9px] px-2 py-0.5 rounded-lg font-black uppercase">Менеджер на связи</span>
                                        )}
                                    </h2>
                                    <p className="text-xs text-gray-400 font-medium">ID: {selectedSession.id.slice(0,8)} • {selectedSession.visitor_id.slice(-8)}</p>
                                </div>
                            </div>
                            
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => toggleTakeover(selectedSession.id, selectedSession.is_human_takeover)}
                                    className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 ${
                                        selectedSession.is_human_takeover 
                                        ? 'bg-green-500 text-white hover:bg-green-600 shadow-green-200' 
                                        : 'bg-orange-600 text-white hover:bg-orange-700 shadow-orange-200'
                                    }`}
                                >
                                    {selectedSession.is_human_takeover ? 'Вернуть ИИ' : 'Перехватить диалог'}
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 flex overflow-hidden">
                            {/* Chat Window */}
                            <div className="flex-1 flex flex-col bg-gray-50/30">
                                <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
                                    {messages.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-300">
                                            <span className="text-4xl mb-4 opacity-30">💬</span>
                                            <p className="text-sm font-bold uppercase tracking-widest opacity-50">Диалог еще не начат</p>
                                        </div>
                                    ) : (
                                        messages.map(m => (
                                            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                                                <div className={`max-w-[75%] p-5 rounded-3xl text-sm shadow-xl transition-all hover:scale-[1.02] ${
                                                    m.role === 'user' 
                                                    ? 'bg-white text-gray-800 border border-gray-100 rounded-bl-none' 
                                                    : m.role === 'assistant' 
                                                        ? 'bg-gray-900 text-white rounded-br-none'
                                                        : 'bg-blue-50 text-blue-600 text-[10px] italic py-2 border border-blue-100 w-full text-center rounded-xl'
                                                }`}>
                                                    {m.content}
                                                    <div className={`text-[8px] mt-2 font-bold opacity-40 text-right ${m.role === 'assistant' ? 'text-gray-400' : 'text-gray-400'}`}>
                                                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Modern Input */}
                                <form onSubmit={handleSend} className="p-8 bg-white border-t">
                                    <div className="relative group">
                                        <input 
                                            type="text" 
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            placeholder={selectedSession.is_human_takeover ? "Напишите клиенту..." : "Режим наблюдения: Елена общается"}
                                            disabled={!selectedSession.is_human_takeover || sending}
                                            className="w-full bg-gray-50 border-2 border-gray-100 rounded-3xl p-5 pr-16 text-sm focus:ring-0 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
                                        />
                                        <button 
                                            type="submit" 
                                            disabled={!selectedSession.is_human_takeover || !input.trim() || sending}
                                            className="absolute right-3 top-3 bg-blue-600 text-white w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-95"
                                        >
                                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2,21L23,12L2,3V10L17,12L2,14V21Z"></path></svg>
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* User Data Panel (CQ-Style) */}
                            <div className="w-96 border-l bg-white flex flex-col h-full overflow-hidden">
                                <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
                                    {/* Properties */}
                                    <section>
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span> О Посетителе
                                        </h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                                                <p className="text-[8px] font-black text-gray-400 uppercase">Локация</p>
                                                <p className="text-xs font-bold text-gray-700">{selectedSession.geo_city || '—'}</p>
                                            </div>
                                            <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                                                <p className="text-[8px] font-black text-gray-400 uppercase">Источник</p>
                                                <p className="text-xs font-bold text-blue-600">{selectedSession.utm_source || 'Direct'}</p>
                                            </div>
                                            <div className="col-span-2 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                                                <p className="text-[8px] font-black text-gray-400 uppercase">Посадочная страница</p>
                                                <p className="text-[10px] font-medium text-gray-600 truncate">{selectedSession.landing_page}</p>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Manager Notes */}
                                    <section>
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full"></span> Заметки менеджера
                                        </h3>
                                        <textarea 
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            onBlur={saveNotes}
                                            placeholder="Добавьте важную информацию о клиенте..."
                                            className="w-full bg-yellow-50/50 border border-yellow-100 rounded-2xl p-4 text-xs font-medium focus:ring-0 focus:border-yellow-300 outline-none min-h-[100px] resize-none"
                                        />
                                    </section>

                                    {/* Interests */}
                                    {selectedSession.interested_products && selectedSession.interested_products.length > 0 && (
                                        <section>
                                            <h3 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> Горячий интерес
                                            </h3>
                                            <div className="flex flex-wrap gap-2">
                                                {selectedSession.interested_products.map((p, idx) => (
                                                    <div key={idx} className="bg-red-50 text-red-600 text-[10px] font-black px-3 py-1.5 rounded-xl border border-red-100">
                                                        {p}
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    {/* Event Timeline */}
                                    <section>
                                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Таймлайн (Footprint)</h3>
                                        <div className="space-y-6 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-100">
                                            {events.map((e, idx) => (
                                                <div key={e.id} className="relative pl-6">
                                                    <div className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center z-10 ${
                                                        idx === 0 ? 'bg-blue-500' : 'bg-gray-200'
                                                    }`}>
                                                    </div>
                                                    <div className="flex justify-between items-start">
                                                        <p className="text-xs font-black text-gray-700 leading-tight">{e.page_title}</p>
                                                        <span className="text-[8px] font-bold text-gray-300">{new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                    <p className="text-[9px] text-gray-400 truncate mt-0.5">{e.url}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-200 p-20 text-center">
                        <div className="w-32 h-32 bg-gray-50 rounded-full flex items-center justify-center mb-8 border-4 border-dashed border-gray-100">
                            <span className="text-6xl animate-bounce">🎯</span>
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 mb-2 uppercase tracking-tighter">Система готова к охоте</h2>
                        <p className="text-gray-400 font-medium max-w-xs">Выберите посетителя слева, чтобы начать мониторинг в реальном времени</p>
                    </div>
                )}
            </div>
        </div>
    );
}
