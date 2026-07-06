'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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
    updated_at: string; // Used for online status
    last_message?: string;
    last_message_time?: string;
    has_contacts?: boolean;
    contact_name?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    contact_company?: string | null;
    crm_order_id?: number | null;
    crm_customer_id?: number | null;
}

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    file_url?: string;
    file_name?: string;
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
    const [search, setSearch] = useState('');
    const [totalContacts, setTotalContacts] = useState<number | null>(null);
    const [totalSessionsCount, setTotalSessionsCount] = useState<number>(0);
    const [totalOrdersCount, setTotalOrdersCount] = useState<number>(0);
    const [capturedContactsList, setCapturedContactsList] = useState<Session[]>([]);
    const [ordersMap, setOrdersMap] = useState<Record<number, any>>({});
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Check if session is "Online" (active in last 5 mins)
    const isOnline = (updatedAt: string) => {
        const lastActive = new Date(updatedAt).getTime();
        const now = new Date().getTime();
        return (now - lastActive) < 5 * 60 * 1000; // 5 minutes window
    };

    const fetchSessions = async () => {
        const [sessRes, countRes, totalRes, ordersCountRes, contactsListRes] = await Promise.all([
            supabase
                .from('widget_sessions')
                .select('*')
                .order('updated_at', { ascending: false })
                .limit(100),
            supabase
                .from('widget_sessions')
                .select('*', { count: 'exact', head: true })
                .eq('has_contacts', true),
            supabase
                .from('widget_sessions')
                .select('*', { count: 'exact', head: true }),
            supabase
                .from('widget_sessions')
                .select('*', { count: 'exact', head: true })
                .not('crm_order_id', 'is', null),
            supabase
                .from('widget_sessions')
                .select('*')
                .eq('has_contacts', true)
                .order('updated_at', { ascending: false })
                .limit(50)
        ]);
        
        if (countRes.count !== null) {
            setTotalContacts(countRes.count);
        }
        if (totalRes.count !== null) {
            setTotalSessionsCount(totalRes.count);
        }
        if (ordersCountRes.count !== null) {
            setTotalOrdersCount(ordersCountRes.count);
        }
        if (contactsListRes.data) {
            setCapturedContactsList(contactsListRes.data);
        }

        const sessData = sessRes.data || [];
        const contactsList = contactsListRes.data || [];
        const orderIds = Array.from(new Set([
            ...sessData.map((s: any) => s.crm_order_id),
            ...contactsList.map((c: any) => c.crm_order_id)
        ].filter(Boolean))) as number[];

        let newOrdersMap: Record<number, any> = {};

        if (orderIds.length > 0) {
            const [ordersRes, managersRes, statusesRes] = await Promise.all([
                supabase
                    .from('orders')
                    .select('order_id, status, totalsumm, raw_payload, manager_id')
                    .in('order_id', orderIds),
                supabase
                    .from('managers')
                    .select('id, first_name, last_name'),
                supabase
                    .from('statuses')
                    .select('code, name, color')
            ]);

            const ordersList = ordersRes.data || [];
            const managersList = managersRes.data || [];
            const statusesList = statusesRes.data || [];

            const managersMap = new Map<number, string>(managersList.map((m: any) => [m.id, `${m.first_name || ''} ${m.last_name || ''}`.trim()]));
            const statusesMap = new Map<string, { name: string | null; color: string | null }>(
                statusesList.map((s: any) => [s.code, { name: s.name, color: s.color }])
            );

            ordersList.forEach((o: any) => {
                const rawPayload = o.raw_payload || {};
                const customer = rawPayload?.customer || {};
                const nameParts = [
                    customer?.lastName || rawPayload?.lastName || '',
                    customer?.firstName || rawPayload?.firstName || '',
                    customer?.patronymic || rawPayload?.patronymic || ''
                ].filter(Boolean);
                let customerName = nameParts.join(' ').trim();
                if (!customerName) {
                    const contragent = rawPayload?.contragent || {};
                    customerName = contragent?.companyName || contragent?.contragentName || '';
                }

                const statusInfo = statusesMap.get(o.status) || { name: o.status || null, color: null };
                const managerName = managersMap.get(o.manager_id) || (rawPayload?.manager ? `${rawPayload.manager.firstName || ''} ${rawPayload.manager.lastName || ''}`.trim() : null);

                newOrdersMap[o.order_id] = {
                    order_id: o.order_id,
                    statusName: statusInfo.name,
                    statusColor: statusInfo.color,
                    amount: o.totalsumm,
                    managerName: managerName || '—',
                    customerName: customerName || null
                };
            });
        }
        setOrdersMap(newOrdersMap);

        if (sessData.length > 0) {
            const sessionsWithPreview = await Promise.all(sessData.map(async (s: any) => {
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

            setSessions(sessionsWithPreview);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchSessions();
        const interval = setInterval(fetchSessions, 30000); // Auto-refresh list every 30s

        const channel = supabase.channel('global-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'widget_sessions' }, () => {
                fetchSessions();
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'widget_messages' }, () => {
                fetchSessions();
            })
            .subscribe();

        return () => { 
            supabase.removeChannel(channel);
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (!selectedSessionId) return;

        const fetchData = async () => {
            const [msgRes, evtRes] = await Promise.all([
                supabase.from('widget_messages').select('*').eq('session_id', selectedSessionId).order('created_at', { ascending: true }),
                supabase.from('widget_events').select('*').eq('session_id', selectedSessionId).order('created_at', { ascending: false })
            ]);

            if (msgRes.data) {
                console.log('DEBUG: Messages loaded', msgRes.data);
                setMessages(msgRes.data);
            }
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
                setMessages((prev: Message[]) => [...prev, payload.new as Message]);
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'widget_events',
                filter: `session_id=eq.${selectedSessionId}`
            }, (payload: any) => {
                setEvents((prev: Event[]) => [payload.new as Event, ...prev]);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [selectedSessionId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const filteredSessions = useMemo(() => {
        if (!search.trim()) return sessions;
        const s = search.toLowerCase();
        return sessions.filter((sess: Session) => 
            (sess.nickname?.toLowerCase().includes(s)) || 
            (sess.geo_city?.toLowerCase().includes(s)) ||
            (sess.id.toLowerCase().includes(s))
        );
    }, [sessions, search]);

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
        setSessions((prev: Session[]) => prev.map((s: Session) => s.id === selectedSessionId ? { ...s, manager_notes: notes } : s));
    };

    const toggleTakeover = async (sessionId: string, current: boolean) => {
        await supabase.from('widget_sessions').update({ is_human_takeover: !current }).eq('id', sessionId);
        setSessions((prev: Session[]) => prev.map((s: Session) => s.id === sessionId ? { ...s, is_human_takeover: !current } : s));
    };

    const selectedSession = sessions.find((s: Session) => s.id === selectedSessionId);
    const getInitials = (name: string | null) => name ? name.split(' ').map((n: string) => n[0]).join('').slice(-2).toUpperCase() : '??';    return (
        <div className="flex h-[calc(100vh-80px)] bg-gray-100 overflow-hidden font-sans">
            {/* Lead List Sidebar */}
            <div className="w-96 border-r bg-white flex flex-col shadow-lg z-20">
                <div className="p-6 border-b bg-gray-900 text-white">
                    <div className="flex justify-between items-center">
                        <h1 className="text-xl font-black flex items-center gap-2">
                            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]"></span> 
                            Ловец Лидов
                        </h1>
                        <a 
                            href="/settings/widget" 
                            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors text-gray-300 hover:text-white"
                            title="Настройки виджета"
                        >
                            <span>⚙️</span> Настройки
                        </a>
                    </div>
                    <div className="mt-4">
                        <input 
                            type="text" 
                            placeholder="Поиск по имени или городу..." 
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-gray-800 border-none rounded-xl py-2 px-4 text-xs text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                        />
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {loading ? (
                        <div className="p-10 text-center text-gray-300 animate-pulse font-bold uppercase text-[10px]">Синхронизация...</div>
                    ) : filteredSessions.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 italic text-sm">Ничего не найдено</div>
                    ) : (
                        filteredSessions.map(s => {
                            const orderDetails = s.crm_order_id ? ordersMap[s.crm_order_id] : null;
                            const displayName = orderDetails?.customerName || s.nickname || 'Аноним';
                            return (
                                <div 
                                    key={s.id} 
                                    onClick={() => setSelectedSessionId(s.id)}
                                    className={`p-4 border-b cursor-pointer transition-all hover:bg-blue-50/50 relative group ${selectedSessionId === s.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="relative">
                                            <div className={`w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center text-xs font-black shadow-sm ${selectedSessionId === s.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                                {getInitials(displayName)}
                                            </div>
                                            {isOnline(s.updated_at) && (
                                                <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full shadow-sm"></div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-sm font-black text-gray-900 truncate flex items-center gap-1.5">
                                                    {displayName}
                                                    {s.has_contacts && (
                                                        <span className="bg-green-100 text-green-800 text-[8px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider" title="Контакт получен">
                                                            📞
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="text-[8px] text-gray-400 font-bold">{new Date(s.updated_at || s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <div className="text-[11px] text-blue-600 font-black truncate">
                                                {s.last_message ? (
                                                    <span className="text-gray-500 font-medium italic">💬 {s.last_message}</span>
                                                ) : (
                                                    <span className="text-gray-300 font-normal italic">Нет сообщений</span>
                                                )}
                                            </div>
                                            <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-1">
                                                <span className="font-bold">{s.geo_city || 'Неизвестно'}</span>
                                                <span>•</span>
                                                <span>{s.domain}</span>
                                            </div>
                                        </div>
                                        {s.is_human_takeover && (
                                            <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0 mt-1 animate-pulse"></div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative bg-white">
                {selectedSession ? (
                    <>
                        {/* Session Header */}
                        {(() => {
                            const selectedSessionDetails = selectedSession?.crm_order_id ? ordersMap[selectedSession.crm_order_id] : null;
                            const selectedDisplayName = selectedSessionDetails?.customerName || selectedSession?.nickname || 'Аноним';
                            return (
                                <div className="px-8 py-6 border-b flex justify-between items-center bg-white/80 backdrop-blur-md z-10 sticky top-0">
                                    <div className="flex items-center gap-4">
                                        <div className="relative">
                                            <div className="w-12 h-12 rounded-3xl bg-gray-900 text-white flex items-center justify-center text-lg font-black">
                                                {getInitials(selectedDisplayName)}
                                            </div>
                                            {isOnline(selectedSession.updated_at) && (
                                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full shadow-lg"></div>
                                            )}
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                                                {selectedDisplayName}
                                                {selectedSession.is_human_takeover && (
                                                    <span className="bg-orange-100 text-orange-600 text-[9px] px-2 py-0.5 rounded-lg font-black uppercase tracking-wider">Прямой эфир</span>
                                                )}
                                            </h2>
                                            <p className="text-xs text-gray-400 font-medium">Сессия: {selectedSession.id.slice(0,8)} • {selectedSession.geo_city || 'Братислава?'}</p>
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
                            );
                        })()}

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
                                                <div className={`max-w-[75%] p-5 rounded-3xl text-sm shadow-xl transition-all hover:scale-[1.01] ${
                                                    m.role === 'user' 
                                                    ? 'bg-white text-gray-800 border border-gray-100 rounded-bl-none' 
                                                    : m.role === 'assistant' 
                                                        ? 'bg-gray-900 text-white rounded-br-none'
                                                        : 'bg-blue-50 text-blue-600 text-[10px] italic py-2 border border-blue-100 w-full text-center rounded-xl'
                                                }`}>
                                                    {m.content}
                                                    
                                                    {m.file_url && (
                                                        <div className="mt-4 p-4 bg-blue-50/50 rounded-2xl border-2 border-blue-100 flex items-center justify-between gap-4 shadow-sm">
                                                            <div className="flex items-center gap-3 overflow-hidden">
                                                                <span className="text-2xl">📎</span>
                                                                <div className="flex flex-col overflow-hidden">
                                                                    <span className="text-[10px] font-black text-blue-900 truncate uppercase tracking-tighter">Прикрепленный файл</span>
                                                                    <span className="text-[9px] text-blue-600 truncate opacity-70">{m.file_name || 'документ'}</span>
                                                                </div>
                                                            </div>
                                                            <a 
                                                                href={m.file_url} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer"
                                                                className="bg-blue-600 text-white text-[10px] px-4 py-2 rounded-xl font-black uppercase hover:bg-blue-700 transition-all shadow-md active:scale-95 whitespace-nowrap"
                                                            >
                                                                Открыть
                                                            </a>
                                                        </div>
                                                    )}

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

                            {/* User Data Panel */}
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
                                    
                                    {/* Captured Contacts */}
                                    {(selectedSession.has_contacts || selectedSession.contact_phone || selectedSession.contact_email) && (
                                        <section>
                                            <h3 className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> Контактные данные
                                            </h3>
                                            <div className="bg-green-50/50 p-4 rounded-2xl border border-green-150 space-y-3">
                                                {selectedSession.contact_name && (
                                                    <div>
                                                        <p className="text-[8px] font-black text-green-700 uppercase">Имя</p>
                                                        <p className="text-xs font-bold text-gray-800">{selectedSession.contact_name}</p>
                                                    </div>
                                                )}
                                                {selectedSession.contact_phone && (
                                                    <div>
                                                        <p className="text-[8px] font-black text-green-700 uppercase">Телефон</p>
                                                        <p className="text-xs font-bold text-gray-800">{selectedSession.contact_phone}</p>
                                                    </div>
                                                )}
                                                {selectedSession.contact_email && (
                                                    <div>
                                                        <p className="text-[8px] font-black text-green-700 uppercase">Email</p>
                                                        <p className="text-xs font-bold text-gray-800">{selectedSession.contact_email}</p>
                                                    </div>
                                                )}
                                                {selectedSession.contact_company && (
                                                    <div>
                                                        <p className="text-[8px] font-black text-green-700 uppercase">Компания</p>
                                                        <p className="text-xs font-bold text-gray-800">{selectedSession.contact_company}</p>
                                                    </div>
                                                )}
                                                {!selectedSession.contact_name && !selectedSession.contact_phone && !selectedSession.contact_email && !selectedSession.contact_company && (
                                                    <p className="text-xs font-medium text-green-800 italic">Контакт определен, но данные еще не структурированы.</p>
                                                )}
                                            </div>
                                        </section>
                                    )}

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
                    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-y-auto p-8 space-y-8">
                        <div>
                            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Аналитика и Лиды</h2>
                            <p className="text-xs text-gray-400 font-bold mt-1">ОБЗОР АКТИВНОСТИ ИИ-КОНСУЛЬТАНТА ЕЛЕНЫ</p>
                        </div>

                        {/* Metrics Cards */}
                        <div className="grid grid-cols-4 gap-4">
                            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between min-h-[110px]">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Всего диалогов</span>
                                <div className="flex items-baseline gap-2 mt-2">
                                    <span className="text-3xl font-black text-gray-900">{totalSessionsCount}</span>
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between min-h-[110px]">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-green-600">Захвачено контактов</span>
                                <div className="flex items-baseline gap-2 mt-2">
                                    <span className="text-3xl font-black text-green-600">{totalContacts || 0}</span>
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between min-h-[110px]">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-blue-600">Создано заказов</span>
                                <div className="flex items-baseline gap-2 mt-2">
                                    <span className="text-3xl font-black text-blue-600">{totalOrdersCount}</span>
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between min-h-[110px]">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-purple-600">Конверсия</span>
                                <div className="flex items-baseline gap-2 mt-2">
                                    <span className="text-3xl font-black text-purple-600">
                                        {totalSessionsCount > 0 ? (((totalContacts || 0) / totalSessionsCount) * 100).toFixed(1) : 0}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Contacts Table Block */}
                        <div className="bg-white rounded-3xl border border-gray-150 shadow-sm overflow-hidden flex flex-col">
                            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Список захваченных контактов</h3>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Последние 50 записей</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            <th className="px-6 py-4">Имя посетителя</th>
                                            <th className="px-6 py-4">Телефон / Email</th>
                                            <th className="px-6 py-4">Локация</th>
                                            <th className="px-6 py-4">RetailCRM Заказ</th>
                                            <th className="px-6 py-4 text-right">Дата / Время</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {capturedContactsList.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-12 text-center text-xs text-gray-400 italic">
                                                    Контакты пока не собраны
                                                </td>
                                            </tr>
                                        ) : (
                                            capturedContactsList.map(item => {
                                                const hasOrder = item.crm_order_id !== null && item.crm_order_id !== undefined;
                                                const orderDetails = item.crm_order_id ? ordersMap[item.crm_order_id] : null;
                                                const displayName = orderDetails?.customerName || item.nickname || 'Аноним';
                                                return (
                                                    <tr 
                                                        key={item.id} 
                                                        onClick={() => setSelectedSessionId(item.id)}
                                                        className="hover:bg-blue-50/20 cursor-pointer transition-all text-xs"
                                                    >
                                                        <td className="px-6 py-4 font-bold text-gray-900">
                                                            {displayName}
                                                        </td>
                                                        <td className="px-6 py-4 space-y-0.5">
                                                            {item.contact_phone && <p className="font-bold text-gray-700">{item.contact_phone}</p>}
                                                            {item.contact_email && <p className="text-gray-400 font-medium">{item.contact_email}</p>}
                                                            {!item.contact_phone && !item.contact_email && <span className="text-gray-300 italic">нет данных</span>}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex flex-col">
                                                                <span className="font-bold text-gray-700">{item.geo_city || '—'}</span>
                                                                <span className="text-[9px] text-gray-400">{item.domain}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4" onClick={(e) => hasOrder && e.stopPropagation()}>
                                                            {hasOrder ? (
                                                                <div className="flex flex-col gap-1">
                                                                    <a 
                                                                        href={`https://zmktlt.retailcrm.ru/orders/${item.crm_order_id}/edit`} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer" 
                                                                        className="text-blue-600 font-bold hover:text-blue-800 hover:underline text-sm"
                                                                    >
                                                                        #{item.crm_order_id} ↗
                                                                    </a>
                                                                    {orderDetails && (
                                                                        <div className="text-[10px] text-gray-500 space-y-0.5 mt-0.5">
                                                                            <div className="flex items-center gap-1">
                                                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: orderDetails.statusColor || '#CBD5E1' }}></span>
                                                                                <span className="font-semibold text-gray-700">{orderDetails.statusName || 'Без статуса'}</span>
                                                                            </div>
                                                                            <p className="font-bold text-gray-800">Сумма: {orderDetails.amount?.toLocaleString() || 0} руб.</p>
                                                                            <p className="text-gray-450">Менеджер: {orderDetails.managerName || '—'}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-300 italic text-[10px]">в очереди...</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 text-right text-gray-400 font-medium">
                                                            {new Date(item.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
