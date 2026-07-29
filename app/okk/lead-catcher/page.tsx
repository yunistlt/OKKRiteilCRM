'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/utils/supabase';
import { formatIntRu, formatRub } from '@/lib/format';
import { useAsyncAction } from '@/components/ui/useAsyncAction';
import Spinner from '@/components/ui/Spinner';

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
    channel?: ChannelKey;
}

type ChannelKey = 'chat' | 'call' | 'cart';
type ViewKey = 'all' | ChannelKey;
type MetricKey = 'dialogs' | 'contacts' | 'orders' | 'conversion';
interface Metrics { dialogs: number; contacts: number; orders: number; conversion: number; }

// Каналы захвата («ловцы»). Цвета — по голдам: смелые 100% заливки-акценты.
const CHANNEL_META: Record<ViewKey, { label: string; short: string; sub: string; icon: string; color: string }> = {
    all:  { label: 'Сводная',          short: 'Все',     sub: 'Все каналы',       icon: '📊', color: '#111827' },
    chat: { label: 'Чат на сайте',     short: 'Чат',     sub: 'Диалоги с Еленой', icon: '💬', color: '#2563eb' },
    call: { label: 'Обратный звонок',  short: 'Звонок',  sub: 'Заявки на дозвон', icon: '📞', color: '#16a34a' },
    cart: { label: 'Заказ из корзины', short: 'Корзина', sub: 'Корзина на email', icon: '🛒', color: '#d97706' },
};
const CHANNEL_ORDER: ViewKey[] = ['all', 'chat', 'call', 'cart'];
const METRIC_META: Record<MetricKey, { label: string; color: string }> = {
    dialogs:    { label: 'Обращения',  color: '#4b5563' },
    contacts:   { label: 'Контакты',   color: '#16a34a' },
    orders:     { label: 'Заказы',     color: '#2563eb' },
    conversion: { label: 'Конверсия',  color: '#7c3aed' },
};
const EMPTY_METRICS: Metrics = { dialogs: 0, contacts: 0, orders: 0, conversion: 0 };

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
    // Мгновенный отклик на клик (golds/GOLD_DESIGN_UX.md §2)
    const { run, isPending } = useAsyncAction();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [events, setEvents] = useState<Event[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [notes, setNotes] = useState('');
    const [search, setSearch] = useState('');
    const [capturedContactsList, setCapturedContactsList] = useState<Session[]>([]);
    const [ordersMap, setOrdersMap] = useState<Record<number, any>>({});

    // Analytics states (разбивка по каналам захвата)
    const [channel, setChannel] = useState<ViewKey>('all');
    const [dialogsOpen, setDialogsOpen] = useState(false); // модалка «Живые диалоги» (канал «Чат на сайте»)
    const [channelTotals, setChannelTotals] = useState<Record<string, Metrics>>({});
    const [selectedRange, setSelectedRange] = useState<'week' | 'month' | 'quarter' | 'year'>('week');
    const [selectedMetric, setSelectedMetric] = useState<MetricKey>('dialogs');
    const [analyticsData, setAnalyticsData] = useState<any[]>([]);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [hoveredPointIdx, setHoveredPointIdx] = useState<number | null>(null);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Check if session is "Online" (active in last 5 mins)
    const isOnline = (updatedAt: string) => {
        const lastActive = new Date(updatedAt).getTime();
        const now = new Date().getTime();
        return (now - lastActive) < 5 * 60 * 1000; // 5 minutes window
    };

    const fetchAnalytics = async () => {
        setAnalyticsLoading(true);
        try {
            const res = await fetch(`/api/lead-catcher/analytics?range=${selectedRange}`);
            const data = await res.json();
            if (data.points) setAnalyticsData(data.points);
            if (data.totals) setChannelTotals(data.totals);
            if (data.contacts) {
                setCapturedContactsList(data.contacts);
                // Подтягиваем детали заказов для контактов, которых ещё нет в ordersMap.
                const orderIds = Array.from(new Set(
                    (data.contacts as Session[]).map((c) => c.crm_order_id).filter(Boolean)
                )) as number[];
                if (orderIds.length > 0) {
                    try {
                        const oRes = await fetch('/api/lead-catcher/orders-info', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ orderIds })
                        });
                        const oData = await oRes.json();
                        if (oData.orders) setOrdersMap((prev) => ({ ...prev, ...oData.orders }));
                    } catch (err) {
                        console.error('Ошибка деталей заказов для аналитики:', err);
                    }
                }
            }
        } catch (err) {
            console.error('Ошибка загрузки аналитики:', err);
        } finally {
            setAnalyticsLoading(false);
        }
    };

    const fetchSessions = async () => {
        // Список слева (последние сессии) + детали их заказов. Итоги и таблица
        // контактов теперь приходят из /api/lead-catcher/analytics (с меткой канала).
        const sessRes = await supabase
            .from('widget_sessions')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(100);

        const sessData = sessRes.data || [];
        const orderIds = Array.from(new Set(
            sessData.map((s: any) => s.crm_order_id).filter(Boolean)
        )) as number[];

        if (orderIds.length > 0) {
            try {
                const res = await fetch('/api/lead-catcher/orders-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderIds })
                });
                const data = await res.json();
                if (data.orders) {
                    setOrdersMap((prev) => ({ ...prev, ...data.orders }));
                }
            } catch (err) {
                console.error('Ошибка получения деталей заказов через API:', err);
            }
        }

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
        fetchAnalytics();
    }, [selectedRange]);

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

    // Метрики выбранного канала для карточек KPI.
    const activeTotals: Metrics = channelTotals[channel] || EMPTY_METRICS;
    const contactsForChannel = useMemo(
        () => channel === 'all' ? capturedContactsList : capturedContactsList.filter((c) => c.channel === channel),
        [capturedContactsList, channel]
    );

    // --- Геометрия графика: одна линия на канал (в сводной — три). ---
    const chartWidth = 800;
    const chartHeight = 200;
    const paddingLeft = 45;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;
    const usableWidth = chartWidth - paddingLeft - paddingRight;
    const usableHeight = chartHeight - paddingTop - paddingBottom;

    const chart = useMemo(() => {
        const drawn: ChannelKey[] = channel === 'all' ? ['chat', 'call', 'cart'] : [channel];
        const valAt = (p: any, ch: ChannelKey): number => (p?.[ch]?.[selectedMetric] ?? 0);

        const flat = analyticsData.flatMap((p) => drawn.map((ch) => valAt(p, ch)));
        const rawMax = Math.max(0, ...flat);
        const maxVal = rawMax === 0 ? 10 : rawMax * 1.15;

        const xOf = (i: number) => paddingLeft + (i * usableWidth) / Math.max(analyticsData.length - 1, 1);
        const yOf = (v: number) => chartHeight - paddingBottom - (v / maxVal) * usableHeight;

        const series = drawn.map((ch) => {
            const color = channel === 'all' ? CHANNEL_META[ch].color : METRIC_META[selectedMetric].color;
            const pts = analyticsData.map((p, i) => ({ x: xOf(i), y: yOf(valAt(p, ch)), val: valAt(p, ch), label: p.label }));
            const line = pts.length ? `M ${pts.map((q) => `${q.x},${q.y}`).join(' L ')}` : '';
            const area = pts.length
                ? `M ${pts[0].x},${chartHeight - paddingBottom} L ${pts.map((q) => `${q.x},${q.y}`).join(' L ')} L ${pts[pts.length - 1].x},${chartHeight - paddingBottom} Z`
                : '';
            return { key: ch, color, pts, line, area };
        });

        const yGrid = [] as { y: number; val: string | number }[];
        for (let i = 0; i <= 4; i++) {
            const v = (maxVal / 4) * i;
            yGrid.push({ y: yOf(v), val: selectedMetric === 'conversion' ? `${v.toFixed(1)}%` : Math.round(v) });
        }
        const step = Math.max(1, Math.ceil(analyticsData.length / 8));
        const xLabels = analyticsData.map((p, i) => ({ x: xOf(i), label: p.label, i })).filter((o) => o.i % step === 0);

        return { drawn, series, yGrid, xLabels, maxVal, single: channel !== 'all' };
    }, [analyticsData, channel, selectedMetric, usableWidth, usableHeight]);

    const selectedSession = sessions.find((s: Session) => s.id === selectedSessionId);
    const getInitials = (name: string | null) => name ? name.split(' ').map((n: string) => n[0]).join('').slice(-2).toUpperCase() : '??';
    const onlineCount = sessions.filter((s) => isOnline(s.updated_at)).length;
    return (
        <div className="flex flex-col h-[calc(100vh-80px)] bg-gray-100 overflow-hidden font-sans">
            {/* Модалка «Живые диалоги»: список диалогов + переписка. Открывается кнопкой на канале «Чат на сайте». */}
            {dialogsOpen && (
                <div className="fixed inset-0 z-[100] bg-black/60" onClick={() => setDialogsOpen(false)}>
                    <div className="absolute inset-4 md:inset-6 bg-white border border-gray-300 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        {/* Шапка модалки */}
                        <div className="bg-gray-900 text-white flex items-center gap-3 px-5 py-3.5 flex-none">
                            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse"></span>
                            <h2 className="text-[15px] font-black flex items-center gap-2">
                                Живые диалоги
                                <span className="text-[10px] font-black bg-blue-600 text-white px-2 py-0.5 uppercase tracking-wider">💬 Чат на сайте</span>
                            </h2>
                            <span className="text-[11px] text-gray-400 font-bold ml-1">{onlineCount} онлайн · {formatIntRu(sessions.length)} в списке</span>
                            <button onClick={() => setDialogsOpen(false)} className="ml-auto w-8 h-8 grid place-items-center border border-gray-700 text-gray-300 hover:bg-gray-800 text-lg leading-none">✕</button>
                        </div>
                        <div className="flex-1 flex min-h-0">
                            {/* Список диалогов */}
                            <div className="w-96 border-r border-gray-300 bg-white flex flex-col min-h-0">
                <div className="p-3 border-b border-gray-300 flex items-center gap-2">
                    <input
                        type="text"
                        placeholder="Поиск по имени или городу…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="flex-1 bg-gray-100 border border-gray-300 py-2 px-3 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-blue-500"
                    />
                    <a
                        href="/settings/widget"
                        title="Настройки виджета"
                        className="w-9 h-9 flex-none grid place-items-center border border-gray-300 text-gray-500 hover:bg-gray-100 text-sm"
                    >
                        ⚙️
                    </a>
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

                            {/* Переписка выбранного диалога */}
                            <div className="flex-1 flex flex-col relative bg-white min-w-0">
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
                                            onClick={() => run(`takeover:${selectedSession.id}`, () => toggleTakeover(selectedSession.id, selectedSession.is_human_takeover))}
                                            disabled={isPending(`takeover:${selectedSession.id}`)}
                                            aria-busy={isPending(`takeover:${selectedSession.id}`) || undefined}
                                            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${
                                                selectedSession.is_human_takeover
                                                ? 'bg-green-500 text-white hover:bg-green-600 shadow-green-200'
                                                : 'bg-orange-600 text-white hover:bg-orange-700 shadow-orange-200'
                                            }`}
                                        >
                                            {isPending(`takeover:${selectedSession.id}`) && <Spinner />}
                                            {isPending(`takeover:${selectedSession.id}`)
                                                ? 'Переключаем…'
                                                : selectedSession.is_human_takeover ? 'Вернуть ИИ' : 'Перехватить диалог'}
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
                                    <div className="flex-1 flex items-center justify-center bg-gray-100 text-gray-400 text-sm font-bold px-6 text-center">
                                        Выберите диалог слева, чтобы открыть переписку
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Аналитика — на всю ширину, всегда видна */}
            <div className="flex-1 flex flex-col relative bg-white overflow-hidden">
                    <div className="flex-1 flex flex-col h-full bg-gray-100 overflow-y-auto">
                        <div className="p-5 space-y-4">
                            {/* Заголовок */}
                            <div>
                                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Аналитика и Лиды</h2>
                                <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider mt-1">Ловец лидов Елены · разбивка по каналам захвата</p>
                            </div>

                            {/* Переключатель каналов (навигация) */}
                            <div className="flex flex-wrap border border-gray-300 bg-white w-max max-w-full">
                                {CHANNEL_ORDER.map((c) => {
                                    const active = channel === c;
                                    const meta = CHANNEL_META[c];
                                    return (
                                        <button
                                            key={c}
                                            onClick={() => setChannel(c)}
                                            className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold border-r border-gray-300 last:border-r-0 transition-colors duration-75 ${active ? 'text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                                            style={active ? { backgroundColor: meta.color } : undefined}
                                        >
                                            <span className="text-[15px] leading-none">{meta.icon}</span>
                                            {meta.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Живые диалоги — вход в инбокс (только канал «Чат на сайте») */}
                            {channel === 'chat' && (
                                <div className="flex items-stretch border border-gray-300 bg-white">
                                    <div className="w-1.5 bg-blue-600 flex-none"></div>
                                    <div className="flex items-center gap-4 p-4 flex-1 flex-wrap">
                                        <div className="w-11 h-11 bg-blue-50 text-blue-600 grid place-items-center text-xl flex-none">💬</div>
                                        <div className="min-w-0">
                                            <h3 className="text-[15px] font-black text-gray-900">Живые диалоги</h3>
                                            <p className="text-xs text-gray-500 font-semibold mt-0.5">Переписки посетителей с Еленой · перехват и ответ вручную</p>
                                        </div>
                                        <div className="flex gap-6 ml-auto">
                                            <div>
                                                <div className="text-xl font-black text-green-600 leading-none tabular-nums">{onlineCount}</div>
                                                <div className="text-[10px] font-black uppercase tracking-wide text-gray-400 mt-1">онлайн</div>
                                            </div>
                                            <div>
                                                <div className="text-xl font-black text-gray-900 leading-none tabular-nums">{formatIntRu((channelTotals.chat || EMPTY_METRICS).dialogs)}</div>
                                                <div className="text-[10px] font-black uppercase tracking-wide text-gray-400 mt-1">всего</div>
                                            </div>
                                        </div>
                                        <button onClick={() => setDialogsOpen(true)} className="bg-blue-600 text-white text-[13px] font-black px-6 py-3 hover:bg-blue-700 transition-colors whitespace-nowrap">Открыть диалоги →</button>
                                    </div>
                                </div>
                            )}

                            {/* Карточки KPI выбранного канала */}
                            {(() => {
                                const t = activeTotals;
                                const firstLabel = channel === 'call' ? 'Заявок на звонок' : channel === 'cart' ? 'Оформлений из корзины' : channel === 'chat' ? 'Диалогов' : 'Всего обращений';
                                const contactLabel = channel === 'call' ? 'Дозвонов (контакт)' : 'Захвачено контактов';
                                const cards = [
                                    { label: firstLabel, value: formatIntRu(t.dialogs), color: '#111827' },
                                    { label: contactLabel, value: formatIntRu(t.contacts), color: METRIC_META.contacts.color },
                                    { label: 'Создано заказов', value: formatIntRu(t.orders), color: METRIC_META.orders.color },
                                    { label: 'Конверсия в заказ', value: `${t.conversion}%`, color: METRIC_META.conversion.color },
                                ];
                                return (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-300 border border-gray-300">
                                        {cards.map((k, i) => (
                                            <div key={i} className="bg-white p-4 flex flex-col justify-between min-h-[96px]">
                                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">{k.label}</span>
                                                <span className="text-[30px] leading-none font-black tabular-nums mt-3" style={{ color: k.color }}>{k.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}

                            {/* Матрица сравнения каналов — только в сводной */}
                            {channel === 'all' && (
                                <div className="bg-white border border-gray-300">
                                    <div className="px-4 py-3 border-b border-gray-300 flex items-center justify-between gap-3 flex-wrap">
                                        <h3 className="text-[12px] font-black text-gray-900 uppercase tracking-wider">Разбивка по каналам</h3>
                                        <span className="text-[10px] text-gray-400 font-bold uppercase">Итоги за всё время · клик — фильтр канала</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[12px] border-collapse min-w-max">
                                            <thead>
                                                <tr className="bg-gray-100 text-gray-600 text-[10px] uppercase tracking-wider font-black">
                                                    <th className="text-left px-4 py-2.5 border-b border-gray-300">Канал</th>
                                                    <th className="text-right px-4 py-2.5 border-b border-gray-300">Обращения</th>
                                                    <th className="text-right px-4 py-2.5 border-b border-gray-300">Контакты</th>
                                                    <th className="text-right px-4 py-2.5 border-b border-gray-300">Заказы</th>
                                                    <th className="text-right px-4 py-2.5 border-b border-gray-300">Конверсия</th>
                                                    <th className="text-right px-4 py-2.5 border-b border-gray-300">Доля заказов</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(['chat', 'call', 'cart'] as ChannelKey[]).map((ch) => {
                                                    const m = channelTotals[ch] || EMPTY_METRICS;
                                                    const totalOrders = activeTotals.orders || 0;
                                                    const share = totalOrders > 0 ? Math.round((m.orders / totalOrders) * 100) : 0;
                                                    const meta = CHANNEL_META[ch];
                                                    return (
                                                        <tr key={ch} onClick={() => setChannel(ch)} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer">
                                                            <td className="px-4 py-3 text-left">
                                                                <span className="inline-flex items-center gap-2 font-bold text-gray-900">
                                                                    <span className="w-2.5 h-2.5" style={{ backgroundColor: meta.color }}></span>
                                                                    {meta.icon} {meta.label}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-right font-black tabular-nums text-gray-900">{formatIntRu(m.dialogs)}</td>
                                                            <td className="px-4 py-3 text-right font-black tabular-nums text-gray-900">{formatIntRu(m.contacts)}</td>
                                                            <td className="px-4 py-3 text-right font-black tabular-nums text-gray-900">{formatIntRu(m.orders)}</td>
                                                            <td className="px-4 py-3 text-right font-black tabular-nums" style={{ color: METRIC_META.conversion.color }}>{m.conversion}%</td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-2 justify-end">
                                                                    <div className="w-20 h-2 bg-gray-200 overflow-hidden">
                                                                        <div className="h-full" style={{ width: `${share}%`, backgroundColor: meta.color }}></div>
                                                                    </div>
                                                                    <span className="font-black tabular-nums text-gray-700 w-9 text-right">{share}%</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* График динамики */}
                            <div className="bg-white border border-gray-300">
                                <div className="px-4 py-3 border-b border-gray-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-[12px] font-black text-gray-900 uppercase tracking-wider">Динамика показателей</h3>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{channel === 'all' ? 'Все каналы по выбранной метрике' : CHANNEL_META[channel].sub}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 items-center">
                                        {/* Выбор метрики */}
                                        <div className="flex border border-gray-300 text-[10px] font-black uppercase tracking-wider">
                                            {(['dialogs', 'contacts', 'orders', 'conversion'] as MetricKey[]).map((mk) => (
                                                <button
                                                    key={mk}
                                                    onClick={() => setSelectedMetric(mk)}
                                                    className={`px-3 py-1.5 border-r border-gray-300 last:border-r-0 transition-colors duration-75 ${selectedMetric === mk ? 'text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                                                    style={selectedMetric === mk ? { backgroundColor: METRIC_META[mk].color } : undefined}
                                                >
                                                    {METRIC_META[mk].label}
                                                </button>
                                            ))}
                                        </div>
                                        {/* Выбор периода */}
                                        <div className="flex border border-gray-300 text-[10px] font-black uppercase tracking-wider">
                                            {(['week', 'month', 'quarter', 'year'] as const).map((r) => {
                                                const labelMap = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
                                                return (
                                                    <button
                                                        key={r}
                                                        onClick={() => setSelectedRange(r)}
                                                        className={`px-3 py-1.5 border-r border-gray-300 last:border-r-0 transition-colors duration-75 ${selectedRange === r ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                                                    >
                                                        {labelMap[r]}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Легенда */}
                                <div className="flex flex-wrap gap-4 px-4 pt-3">
                                    {channel === 'all'
                                        ? (['chat', 'call', 'cart'] as ChannelKey[]).map((ch) => (
                                            <span key={ch} className="inline-flex items-center gap-2 text-[11px] font-bold text-gray-600">
                                                <span className="w-3 h-[3px]" style={{ backgroundColor: CHANNEL_META[ch].color }}></span>
                                                {CHANNEL_META[ch].icon} {CHANNEL_META[ch].label}
                                            </span>
                                        ))
                                        : (
                                            <span className="inline-flex items-center gap-2 text-[11px] font-bold text-gray-600">
                                                <span className="w-3 h-[3px]" style={{ backgroundColor: METRIC_META[selectedMetric].color }}></span>
                                                {METRIC_META[selectedMetric].label} — {CHANNEL_META[channel].label}
                                            </span>
                                        )}
                                </div>

                                <div className="p-4">
                                    {analyticsLoading ? (
                                        <div className="h-[240px] flex items-center justify-center text-xs text-gray-400">Загрузка данных динамики…</div>
                                    ) : analyticsData.length === 0 ? (
                                        <div className="h-[240px] flex items-center justify-center text-xs text-gray-400 border border-dashed border-gray-300">Нет данных за выбранный период</div>
                                    ) : (
                                        <div className="relative w-full overflow-hidden">
                                            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto overflow-visible">
                                                {/* Сетка Y */}
                                                {chart.yGrid.map((g, idx) => (
                                                    <g key={idx}>
                                                        <line x1={paddingLeft} y1={g.y} x2={chartWidth - paddingRight} y2={g.y} stroke="#E5E7EB" strokeWidth={1} />
                                                        <text x={paddingLeft - 8} y={g.y + 3} textAnchor="end" className="fill-gray-400 font-bold text-[9px]">{g.val}</text>
                                                    </g>
                                                ))}
                                                {/* Подписи X */}
                                                {chart.xLabels.map((pt, idx) => (
                                                    <text key={idx} x={pt.x} y={chartHeight - 8} textAnchor="middle" className="fill-gray-400 font-bold text-[9px]">{pt.label}</text>
                                                ))}
                                                {/* Линии-серии */}
                                                {chart.series.map((s) => (
                                                    <g key={s.key}>
                                                        {chart.single && <path d={s.area} fill={s.color} opacity={0.08} />}
                                                        <path d={s.line} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                                                        {s.pts.map((q, i) => (
                                                            (chart.single || i === s.pts.length - 1 || hoveredPointIdx === i) ? (
                                                                <circle key={i} cx={q.x} cy={q.y} r={hoveredPointIdx === i ? 4 : 2.6} fill="#FFFFFF" stroke={s.color} strokeWidth={2} />
                                                            ) : null
                                                        ))}
                                                    </g>
                                                ))}
                                                {/* Направляющая при наведении */}
                                                {hoveredPointIdx !== null && chart.series[0]?.pts[hoveredPointIdx] && (
                                                    <line x1={chart.series[0].pts[hoveredPointIdx].x} y1={paddingTop} x2={chart.series[0].pts[hoveredPointIdx].x} y2={chartHeight - paddingBottom} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="2 2" />
                                                )}
                                                {/* Зоны наведения */}
                                                {analyticsData.map((_, idx) => {
                                                    const x = paddingLeft + (idx * usableWidth) / Math.max(analyticsData.length - 1, 1);
                                                    const w = usableWidth / Math.max(analyticsData.length - 1, 1);
                                                    return <rect key={idx} x={x - w / 2} y={paddingTop} width={w} height={usableHeight} fill="transparent" className="cursor-pointer" onMouseEnter={() => setHoveredPointIdx(idx)} onMouseLeave={() => setHoveredPointIdx(null)} />;
                                                })}
                                            </svg>

                                            {/* Тултип */}
                                            {hoveredPointIdx !== null && analyticsData[hoveredPointIdx] && (() => {
                                                const p = analyticsData[hoveredPointIdx];
                                                const anchorX = paddingLeft + (hoveredPointIdx * usableWidth) / Math.max(analyticsData.length - 1, 1);
                                                const fmtM = (v: number, m: MetricKey) => m === 'conversion' ? `${v}%` : formatIntRu(v);
                                                const rows = channel === 'all'
                                                    ? (['chat', 'call', 'cart'] as ChannelKey[]).map((ch) => ({ label: `${CHANNEL_META[ch].icon} ${CHANNEL_META[ch].label}`, val: fmtM(p[ch]?.[selectedMetric] ?? 0, selectedMetric), color: CHANNEL_META[ch].color }))
                                                    : (['dialogs', 'contacts', 'orders', 'conversion'] as MetricKey[]).map((mk) => ({ label: METRIC_META[mk].label, val: fmtM(p[channel]?.[mk] ?? 0, mk), color: METRIC_META[mk].color }));
                                                return (
                                                    <div className="absolute bg-gray-900 text-white p-2.5 text-[10px] pointer-events-none z-30 flex flex-col gap-1 border border-gray-700" style={{ left: `${((anchorX - paddingLeft) / usableWidth) * 85 + 7}%`, top: 8, transform: 'translateX(-50%)' }}>
                                                        <p className="font-black border-b border-gray-700 pb-1 text-gray-400">Период: {p.label}</p>
                                                        <div className="space-y-0.5 pt-1">
                                                            {rows.map((r, i) => (
                                                                <p key={i} className="flex justify-between gap-4">
                                                                    <span style={{ color: r.color }}>{r.label}</span>
                                                                    <span className="font-bold" style={{ color: r.color }}>{r.val}</span>
                                                                </p>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Таблица захваченных контактов */}
                            <div className="bg-white border border-gray-300">
                                <div className="px-4 py-3 bg-gray-900 text-white flex items-center justify-between">
                                    <h3 className="text-[11px] font-black uppercase tracking-wider">
                                        Захваченные контакты{channel !== 'all' ? ` — ${CHANNEL_META[channel].label.toLowerCase()}` : ''}
                                    </h3>
                                    <span className="text-[9px] text-gray-400 font-bold uppercase">{contactsForChannel.length} записей</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-[11px] min-w-max">
                                        <thead>
                                            <tr className="bg-gray-100 border-b border-gray-300 text-gray-600 font-black text-[10px] uppercase tracking-wider">
                                                <th className="px-4 py-2.5">Имя посетителя</th>
                                                {channel === 'all' && <th className="px-4 py-2.5">Канал</th>}
                                                <th className="px-4 py-2.5">Телефон / Email</th>
                                                <th className="px-4 py-2.5">Локация / Сайт</th>
                                                <th className="px-4 py-2.5">RetailCRM Заказ</th>
                                                <th className="px-4 py-2.5 text-right">Дата / Время</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {contactsForChannel.length === 0 ? (
                                                <tr>
                                                    <td colSpan={channel === 'all' ? 6 : 5} className="px-4 py-12 text-center text-gray-400">
                                                        Контакты пока не собраны
                                                    </td>
                                                </tr>
                                            ) : (
                                                contactsForChannel.map((item, idx) => {
                                                    const hasOrder = item.crm_order_id !== null && item.crm_order_id !== undefined;
                                                    const orderDetails = item.crm_order_id ? ordersMap[item.crm_order_id] : null;
                                                    const displayName = orderDetails?.customerName || item.contact_name || item.nickname || 'Аноним';
                                                    const chMeta = CHANNEL_META[(item.channel || 'chat') as ViewKey];
                                                    return (
                                                        <tr
                                                            key={item.id}
                                                            onClick={() => setSelectedSessionId(item.id)}
                                                            className={`hover:bg-blue-50 cursor-pointer border-b border-gray-200 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                                                        >
                                                            <td className="px-4 py-3 font-bold text-gray-900 align-top">{displayName}</td>
                                                            {channel === 'all' && (
                                                                <td className="px-4 py-3 align-top">
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black text-white whitespace-nowrap" style={{ backgroundColor: chMeta.color }}>
                                                                        {chMeta.icon} {chMeta.short}
                                                                    </span>
                                                                </td>
                                                            )}
                                                            <td className="px-4 py-3 space-y-0.5 align-top">
                                                                {item.contact_phone && <p className="font-bold text-gray-700">{item.contact_phone}</p>}
                                                                {item.contact_email && <p className="text-gray-400 font-medium">{item.contact_email}</p>}
                                                                {!item.contact_phone && !item.contact_email && <span className="text-gray-300 italic">нет данных</span>}
                                                            </td>
                                                            <td className="px-4 py-3 align-top">
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold text-gray-700">{item.geo_city || '—'}</span>
                                                                    <span className="text-[9px] text-gray-400">{item.domain}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 align-top" onClick={(e) => hasOrder && e.stopPropagation()}>
                                                                {hasOrder ? (
                                                                    <div className="flex flex-col gap-1 min-w-[150px]">
                                                                        <a
                                                                            href={`https://zmktlt.retailcrm.ru/orders/${item.crm_order_id}/edit`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-blue-600 font-bold hover:underline text-[11px]"
                                                                        >
                                                                            #{item.crm_order_id} ↗
                                                                        </a>
                                                                        {orderDetails && (
                                                                            <div className="text-[9px] text-gray-500 space-y-0.5 mt-0.5">
                                                                                <div className="flex items-center gap-1">
                                                                                    <span className="w-1.5 h-1.5" style={{ backgroundColor: orderDetails.statusColor || '#CBD5E1' }}></span>
                                                                                    <span className="font-bold text-gray-700">{orderDetails.statusName || 'Без статуса'}</span>
                                                                                </div>
                                                                                <p className="font-bold text-gray-800">Сумма: {formatRub(orderDetails.amount || 0)}</p>
                                                                                <p className="text-gray-400">Менеджер: {orderDetails.managerName || '—'}</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-gray-300 italic text-[10px]">в очереди…</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-gray-400 font-medium align-top">
                                                                {new Date(item.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
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
                    </div>
            </div>
        </div>
    );
}
