'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Agent {
    agent_id: string;
    name: string;
    role: string;
    status: 'idle' | 'working' | 'busy' | 'offline';
    current_task: string;
    last_active_at: string;
    avatar_url?: string;
}

function PriorityWidget() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [view, setView] = useState<'priorities' | 'team'>('priorities');
    const [crmUrl, setCrmUrl] = useState<string>('');
    const [analyzingOrderId, setAnalyzingOrderId] = useState<number | null>(null);
    const [analysisResults, setAnalysisResults] = useState<Record<number, any>>({});
    const [agents, setAgents] = useState<Agent[]>([]);
    const [isOfficeOpen, setIsOfficeOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [showReaction, setShowReaction] = useState(false);

    useEffect(() => {
        if (isOfficeOpen) {
            setShowReaction(true);
            const timer = setTimeout(() => setShowReaction(false), 3500);
            return () => clearTimeout(timer);
        }
    }, [isOfficeOpen]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const fetchAgents = () => {
            fetch('/api/agents/status')
                .then(res => res.json())
                .then(data => {
                    if (data.success) setAgents(data.agents);
                })
                .catch(e => console.error('Failed to fetch agents', e));
        };
        fetchAgents();
        const interval = setInterval(fetchAgents, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        fetch('/api/analysis/priorities')
            .then(res => res.json())
            .then(data => {
                if (data.ok) {
                    setOrders(data.priorities);
                    setCrmUrl(data.retailCrmUrl || '');
                }
                setLoading(false);
            })
            .catch(e => setLoading(false));
    }, []);

    const handleAnalyze = async (e: any, orderId: number) => {
        e.stopPropagation();
        if (analyzingOrderId) return;

        setAnalyzingOrderId(orderId);
        try {
            const res = await fetch(`/api/analysis/order/${orderId}`);
            const data = await res.json();
            if (data.success) {
                setAnalysisResults(prev => ({ ...prev, [orderId]: data.insights }));
            }
        } catch (e) {
            console.error('Analysis failed', e);
        } finally {
            setAnalyzingOrderId(null);
        }
    };

    const formatMoney = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);

    if (loading) return (
        <div className="w-full max-w-5xl mb-12 bg-white rounded-[40px] p-8 border border-gray-100 shadow-xl shadow-blue-100/50 animate-pulse">
            <div className="h-8 bg-gray-100 w-1/3 rounded-xl mb-6"></div>
            <div className="flex gap-4 mb-6">
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
                <div className="h-20 bg-gray-50 flex-1 rounded-2xl"></div>
            </div>
        </div>
    );

    if (orders.length === 0) return null;

    const stats = {
        red: {
            count: orders.filter(o => o.level === 'red').length,
            sum: orders.filter(o => o.level === 'red').reduce((a, b) => a + b.totalSum, 0)
        },
        yellow: {
            count: orders.filter(o => o.level === 'yellow').length,
            sum: orders.filter(o => o.level === 'yellow').reduce((a, b) => a + b.totalSum, 0)
        },
        green: {
            count: orders.filter(o => o.level === 'green').length,
            sum: orders.filter(o => o.level === 'green').reduce((a, b) => a + b.totalSum, 0)
        },
        black: {
            count: orders.filter(o => o.level === 'black').length,
            sum: orders.filter(o => o.level === 'black').reduce((a, b) => a + b.totalSum, 0)
        }
    };

    const filteredOrders = activeTab ? orders.filter(o => o.level === activeTab) : [];

    return (
        <div className="w-full max-w-5xl mb-12 bg-white rounded-[32px] md:rounded-[40px] p-5 md:p-8 border border-gray-100 shadow-2xl shadow-gray-200/50 relative overflow-hidden">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-gray-900 text-white rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl shadow-lg flex-shrink-0">
                        🚦
                    </div>
                    <div>
                        <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Центр Управления</h2>
                        <div className="flex gap-2 mt-1">
                            <button
                                onClick={() => setView('priorities')}
                                className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full transition-all ${view === 'priorities' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                🚥 Приоритеты
                            </button>
                            <button
                                onClick={() => {
                                    setView('team');
                                    setIsOfficeOpen(true);
                                }}
                                className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full transition-all ${view === 'team' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                👥 Команда ОКК
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Full Screen Office Modal */}
            {isOfficeOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 md:p-10 transition-all duration-500 animate-in fade-in zoom-in">
                    <style dangerouslySetInnerHTML={{
                        __html: `
                        @keyframes semenWaddle {
                            0%, 100% { transform: scale(1.6) rotate(0deg) translateY(0); }
                            25% { transform: scale(1.6) rotate(-8deg) translateY(-15px); }
                            50% { transform: scale(1.6) rotate(0deg) translateY(0); }
                            75% { transform: scale(1.6) rotate(8deg) translateY(-15px); }
                        }
                        @keyframes semenPath {
                            0% { transform: translateX(0) scaleX(1); }
                            45% { transform: translateX(-35vw) scaleX(1); }
                            50% { transform: translateX(-35vw) scaleX(-1); }
                            55% { transform: translateX(-35vw) scaleX(-1); }
                            95% { transform: translateX(0) scaleX(-1); }
                            100% { transform: translateX(0) scaleX(1); }
                        }
                        @keyframes coolerPath {
                            0% { transform: translateX(0) scaleX(1); }
                            40% { transform: translate(30vw, 15vh) scaleX(1); }
                            60% { transform: translate(30vw, 15vh) scaleX(-1); }
                            100% { transform: translateX(0) scaleX(-1); }
                        }
                        @keyframes folderAppear {
                            0% { opacity: 0; transform: scale(0.5) rotate(0); }
                            50% { opacity: 1; transform: scale(1.2) rotate(15deg); }
                            100% { opacity: 0; transform: translateY(-50px) scale(0.5); }
                        }
                        @keyframes sweatDrop {
                            0% { transform: translateY(0) opacity: 0; }
                            50% { opacity: 1; }
                            100% { transform: translateY(20px) opacity: 0; }
                        }
                        @keyframes sipTea {
                            0%, 100% { transform: translate(0, 0) rotate(0); }
                            20%, 50% { transform: translate(-20px, -45px) rotate(-20deg); }
                        }
                        @keyframes chillLean {
                            0%, 100% { transform: rotate(0); }
                            50% { transform: rotate(-10deg) translateY(5px); }
                        }
                        @keyframes talkWobble {
                            0%, 100% { transform: scaleX(1); }
                            50% { transform: scaleX(1.1) rotate(2deg); }
                        }
                        @keyframes eyeBlink {
                            0%, 90%, 100% { transform: scaleY(1); }
                            95% { transform: scaleY(0.1); }
                        }
                        @keyframes clockRotate {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                        .clock-hour { animation: clockRotate 43200s linear infinite; transform-origin: bottom center; }
                        .clock-minute { animation: clockRotate 3600s linear infinite; transform-origin: bottom center; }
                        @keyframes steamFade {
                            0% { transform: translateY(0) scale(0.5); opacity: 0; }
                            50% { opacity: 0.5; }
                            100% { transform: translateY(-20px) scale(1.5); opacity: 0; }
                        }
                        @keyframes zzzFloat {
                            0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
                            50% { opacity: 1; }
                            100% { transform: translate(20px, -40px) scale(1.2); opacity: 0; }
                        }
                        @keyframes legMove {
                            0%, 100% { transform: translateY(0); }
                            50% { transform: translateY(-5px); }
                        }
                        .animate-semen-work {
                            animation: semenPath 12s infinite ease-in-out, semenWaddle 0.6s infinite linear !important;
                            z-index: 100;
                        }
                        .animate-cooler-walk {
                            animation: coolerPath 12s infinite ease-in-out, semenWaddle 0.6s infinite linear !important;
                            z-index: 100;
                        }
                        .folder-drop {
                            animation: folderAppear 2s infinite;
                        }
                        .sweat {
                            animation: sweatDrop 1s infinite;
                        }
                        .eye-blink { animation: eyeBlink 4s infinite linear; }
                        .sip-tea { animation: sipTea 4s infinite ease-in-out; }
                        .chill { animation: chillLean 6s infinite ease-in-out; }
                        .talk { animation: talkWobble 0.8s infinite ease-in-out; }
                        .steam { animation: steamFade 2s infinite ease-out; }
                        .zzz { animation: zzzFloat 3s infinite ease-in-out; }
                    `}} />
                    <div className="relative w-full h-full max-w-[90vw] max-h-[85vh] bg-[#f0e6d2] rounded-[40px] border-[12px] border-[#4a3728] shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col">

                        {/* Control Bar */}
                        <div className="absolute top-6 right-8 z-[110] flex gap-4">
                            <button
                                onClick={() => setIsOfficeOpen(false)}
                                className="bg-[#4a3728] text-white px-6 py-2 rounded-full font-black uppercase text-xs tracking-widest hover:bg-[#5d2e0d] transition-all shadow-lg"
                            >
                                ESC [Закрыть]
                            </button>
                        </div>

                        {/* Wall Clock */}
                        <div className="absolute top-12 left-1/2 -translate-x-1/2 w-28 h-28 bg-white border-4 border-[#4a3728] rounded-full shadow-inner flex items-center justify-center z-20">
                            <div className="relative w-full h-full p-2">
                                {/* Hour Hand */}
                                <div
                                    className="absolute top-1/2 left-1/2 w-1 h-8 bg-gray-600 origin-bottom -translate-x-1/2 -translate-y-full transition-transform duration-1000"
                                    style={{ transform: `translateX(-50%) translateY(-100%) rotate(${(currentTime.getHours() % 12) * 30 + currentTime.getMinutes() * 0.5}deg)` }}
                                ></div>
                                {/* Minute Hand */}
                                <div
                                    className="absolute top-1/2 left-1/2 w-0.5 h-10 bg-gray-900 origin-bottom -translate-x-1/2 -translate-y-full transition-transform duration-75"
                                    style={{ transform: `translateX(-50%) translateY(-100%) rotate(${currentTime.getMinutes() * 6}deg)` }}
                                ></div>
                                {/* Seconds Hand */}
                                <div
                                    className="absolute top-1/2 left-1/2 w-[0.5px] h-11 bg-red-400 origin-bottom -translate-x-1/2 -translate-y-full transition-transform duration-75"
                                    style={{ transform: `translateX(-50%) translateY(-100%) rotate(${currentTime.getSeconds() * 6}deg)` }}
                                ></div>
                                {[...Array(12)].map((_, i) => (
                                    <div key={i} className="absolute inset-0 flex items-start justify-center" style={{ transform: `rotate(${i * 30}deg)` }}>
                                        <div className={`w-1 ${i % 3 === 0 ? 'h-3 bg-gray-400' : 'h-1.5 bg-gray-200'}`}></div>
                                    </div>
                                ))}
                                <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-red-600 rounded-full -translate-x-1/2 -translate-y-1/2 z-30"></div>
                            </div>
                            <div className="absolute -top-6 text-[10px] font-black text-[#4a3728] opacity-50 uppercase tracking-widest">OKKRiteil Time</div>
                        </div>

                        {/* Office Content */}
                        <div className="relative flex-1 overflow-hidden p-8 flex items-center justify-center">

                            {/* Bookshelves (Large Decorative) */}
                            <div className="absolute left-0 top-1/4 bottom-1/4 w-32 bg-[#5d4432] border-r-4 border-[#3d2c20] z-0 flex flex-col gap-2 p-2 shadow-2xl">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="flex-1 border-b-2 border-[#3d2c20] flex gap-1 items-end overflow-hidden">
                                        {[...Array(6)].map((_, j) => (
                                            <div key={j} className={`w-3 h-${Math.floor(Math.random() * 8) + 8} rounded-t-sm`} style={{ backgroundColor: ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed'][Math.floor(Math.random() * 5)] }}></div>
                                        ))}
                                    </div>
                                ))}
                            </div>

                            <div className="absolute right-0 top-1/4 bottom-1/4 w-32 bg-[#5d4432] border-l-4 border-[#3d2c20] z-0 flex flex-col gap-2 p-2 shadow-2xl">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="flex-1 border-b-2 border-[#3d2c20] flex gap-1 items-end justify-end overflow-hidden">
                                        {[...Array(6)].map((_, j) => (
                                            <div key={j} className={`w-3 h-${Math.floor(Math.random() * 8) + 8} rounded-t-sm`} style={{ backgroundColor: ['#212121', '#fafafa', '#4a3728', '#8b4513'][Math.floor(Math.random() * 4)] }}></div>
                                        ))}
                                    </div>
                                ))}
                            </div>

                            {/* Water Cooler */}
                            <div className="absolute bottom-12 right-40 w-16 flex flex-col items-center z-10">
                                <div className="w-12 h-16 bg-blue-200/50 rounded-full border-2 border-blue-300 relative overflow-hidden">
                                    <div className="absolute bottom-0 w-full h-1/2 bg-blue-400 opacity-30 animate-pulse"></div>
                                </div>
                                <div className="w-14 h-24 bg-white border-x-4 border-b-4 border-gray-200 rounded-b-lg flex flex-col items-center justify-center gap-2 shadow-lg">
                                    <div className="flex gap-2">
                                        <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                                    </div>
                                    <div className="w-6 h-1 bg-gray-100 rounded-full"></div>
                                </div>
                            </div>

                            {/* Bookshelves Decor */}
                            <div className="absolute left-0 top-24 bottom-24 w-16 flex flex-col gap-4 z-10 pointer-events-none">
                                {[...Array(6)].map((_, i) => (
                                    <div key={i} className="flex-1 w-full bg-[#4a3728] border-r-4 border-[#3a2b1f] relative flex items-end justify-center p-1 gap-0.5">
                                        {[...Array(Math.floor(Math.random() * 8) + 3)].map((_, j) => (
                                            <div key={j} className={`w-1.5 h-[70%] rounded-t-sm shadow-sm transition-all duration-500`} style={{ backgroundColor: ['#e2e8f0', '#3b82f6', '#ef4444', '#10b981', '#f59e0b'][Math.floor(Math.random() * 5)] }}></div>
                                        ))}
                                        {/* Effect of folder being added */}
                                        <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center">
                                            <div className="w-4 h-6 bg-blue-400 border border-white opacity-0 folder-drop"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Floor and Walls */}
                            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[#d2b48c] border-t-8 border-[#8b4513]"></div>

                            {/* Grid Layout for agents - centered and spacious */}
                            <div className="relative w-full h-full max-w-5xl grid grid-cols-2 grid-rows-2 gap-12 z-10 pt-20">
                                {agents.length === 0 ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 z-20 bg-white/50 backdrop-blur-sm rounded-3xl m-8 border-2 border-dashed border-gray-300">
                                        <p className="text-xl font-black uppercase tracking-widest text-gray-400 mb-2">Общий Сбор...</p>
                                    </div>
                                ) : agents.map((agent: Agent) => {
                                    const isWorking = agent.status === 'working';
                                    const task = agent.current_task?.toLowerCase() || '';
                                    const isSemenSorting = agent.agent_id === 'semen' && isWorking && (task.includes('страниц') || task.includes('разлож'));

                                    // Determing idle behavior based on ID hash
                                    const hash = agent.agent_id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                                    const currentTimeSec = Math.floor(Date.now() / 1000);
                                    const isWalkingToCooler = !isWorking && (currentTimeSec + hash) % 30 < 12; // 12 seconds walk every 30 seconds

                                    const idleVibe = !isWorking && !isWalkingToCooler ? (hash % 3 === 0 ? 'tea' : (hash % 3 === 1 ? 'chill' : 'talk')) : null;

                                    // Direction for talking
                                    const agentIndex = agents.indexOf(agent);
                                    const isLookingLeft = !isWorking && idleVibe === 'talk' && agentIndex % 2 === 0;
                                    const isLookingRight = !isWorking && idleVibe === 'talk' && agentIndex % 2 !== 0;

                                    return (
                                        <div key={agent.agent_id} className={`relative flex flex-col items-center justify-end pb-12 transition-all duration-700 hover:scale-105 group 
                                            ${isSemenSorting ? '' : ''} 
                                            ${idleVibe === 'chill' ? 'chill' : ''} 
                                            ${idleVibe === 'talk' ? 'talk' : ''} 
                                            ${showReaction && !isSemenSorting ? 'z-50' : ''}
                                            ${isLookingLeft ? '-scale-x-100' : ''}`}>
                                            {/* Enhanced Desk Prop */}
                                            <div className={`absolute bottom-6 w-48 h-24 bg-[#8b4513] rounded-t-xl border-4 border-[#5d2e0d] z-0 shadow-2xl overflow-hidden transition-opacity duration-1000 ${isSemenSorting ? 'opacity-30' : 'opacity-100'}`}>
                                                <div className="absolute top-0 left-0 w-full h-2 bg-[#a35116]"></div>
                                                {/* Monitor */}
                                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-20 h-16 bg-gray-900 border-4 border-gray-700 rounded-md shadow-inner flex items-center justify-center">
                                                    <div className="w-full h-full bg-blue-900/20 flex flex-col gap-1 p-1 overflow-hidden">
                                                        <div className="w-1/2 h-1 bg-blue-400 animate-pulse opacity-20"></div>
                                                        <div className="w-3/4 h-1 bg-blue-400 animate-pulse delay-75 opacity-20"></div>
                                                    </div>
                                                </div>
                                                {/* Coffee Mug */}
                                                <div className="absolute top-2 left-4 w-5 h-6 bg-white border-2 border-gray-200 rounded-b-sm rounded-tr-lg">
                                                    <div className="absolute top-1 left-full w-2 h-3 border-2 border-gray-200 border-l-0 rounded-r-full"></div>
                                                </div>
                                            </div>

                                            {/* Character Figure */}
                                            <div className={`relative transition-all duration-1000 transform scale-[1.6] z-10 
                                                 ${isSemenSorting ? 'animate-semen-work' : (isWalkingToCooler ? 'animate-cooler-walk' : (isWorking ? 'animate-bounce' : 'animate-pulse opacity-95 hover:opacity-100'))}
                                                 ${showReaction && !isSemenSorting ? 'scale-[1.8]' : ''}`}>

                                                <div className="[mix-blend-mode:multiply]">
                                                    <img
                                                        src={`/images/agents/${agent.agent_id}.png`}
                                                        alt={agent.name}
                                                        className={`h-40 w-auto object-contain transition-all 
                                                             ${isWorking ? 'brightness(1.02) contrast(1.1)' : 'grayscale-[15%] brightness(1.05)'}`}
                                                    />
                                                </div>

                                                {/* Expressive Integrated Eyes - Smaller and more precise */}
                                                <div className="absolute top-[28%] left-1/2 -translate-x-1/2 w-9 h-4 flex justify-between px-0 pointer-events-none z-30 opacity-95">
                                                    <div className="w-3.5 h-3.5 bg-white rounded-full border-[1.5px] border-black/10 flex items-center justify-center eye-blink shadow-sm overflow-hidden">
                                                        <div className={`w-1.5 h-1.5 bg-black rounded-full transition-all duration-500 ${showReaction ? 'scale-110' : 'scale-90'}`}
                                                            style={{ transform: showReaction ? 'translate(0, -5%)' : `translate(${(Math.sin(currentTimeSec / 2 + hash) * 30)}%, ${(Math.cos(currentTimeSec / 3 + hash) * 30)}%)` }}></div>
                                                    </div>
                                                    <div className="w-3.5 h-3.5 bg-white rounded-full border-[1.5px] border-black/10 flex items-center justify-center eye-blink shadow-sm overflow-hidden">
                                                        <div className={`w-1.5 h-1.5 bg-black rounded-full transition-all duration-500 ${showReaction ? 'scale-110' : 'scale-90'}`}
                                                            style={{ transform: showReaction ? 'translate(0, -5%)' : `translate(${(Math.sin(currentTimeSec / 2 + hash) * 30)}%, ${(Math.cos(currentTimeSec / 3 + hash) * 30)}%)` }}></div>
                                                    </div>
                                                </div>

                                                {/* Hidden Folder when sorting */}
                                                {isSemenSorting && (
                                                    <div className="absolute top-10 left-1/2 -translate-x-1/2 w-8 h-10 bg-blue-500 border-2 border-blue-200 rounded-sm shadow-lg z-20 flex items-center justify-center overflow-hidden">
                                                        <div className="w-full h-1 bg-white/30 mb-1"></div>
                                                        <div className="w-2/3 h-1 bg-white/30"></div>
                                                    </div>
                                                )}

                                                {/* Tea/Coffee Mug for idle tea vibe */}
                                                {idleVibe === 'tea' && (
                                                    <div className="absolute bottom-2 -right-4 w-6 h-8 bg-white border-2 border-gray-200 rounded-sm rounded-tr-lg z-30 sip-tea">
                                                        <div className="absolute top-4 -right-1.5 w-3 h-3 border-2 border-gray-200 rounded-full border-l-0"></div>
                                                        {/* Steam effect */}
                                                        <div className="absolute -top-4 left-1 w-4 h-4 flex flex-col gap-1 items-center opacity-40">
                                                            <div className="w-1 h-3 bg-gray-300 rounded-full steam" style={{ animationDelay: '0s' }}></div>
                                                            <div className="w-1 h-2 bg-gray-300 rounded-full steam" style={{ animationDelay: '1s' }}></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Sweat Drop for working agents */}
                                                {isWorking && (
                                                    <div className="absolute top-4 -right-4 text-2xl sweat pointer-events-none">💧</div>
                                                )}

                                                {/* Headphones for Semyon */}
                                                {agent.agent_id === 'semen' && (task.includes('страниц') || task.includes('разложе')) && (
                                                    <div className="absolute top-6 left-1/2 -translate-x-1/2 w-24 h-24 flex items-center justify-center pointer-events-none">
                                                        <div className="text-5xl filter drop-shadow-xl animate-pulse">🎧</div>
                                                    </div>
                                                )}

                                                {/* Improved Speech Bubble */}
                                                {(isWorking || (showReaction && !isSemenSorting)) && (
                                                    <div className={`absolute -top-20 left-1/2 -translate-x-1/2 bg-white px-5 py-3 rounded-[24px] border-4 border-gray-900 shadow-[0_15px_30px_rgba(0,0,0,0.3)] z-50 min-w-[160px] animate-in slide-in-from-bottom-2 ${showReaction && !isWorking ? 'scale-110' : ''}`}>
                                                        <p className="text-[10px] font-black text-gray-900 uppercase leading-tight text-center tracking-tight">
                                                            {showReaction && !isWorking ? 'Чо нада?' : (isSemenSorting ? (Math.random() > 0.5 ? 'Куда же эту папку...' : 'Так, это в архив...') : agent.current_task)}
                                                        </p>
                                                        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-5 h-5 bg-white border-r-4 border-b-4 border-gray-900 rotate-45"></div>
                                                    </div>
                                                )}

                                                {/* Hands behind head simulation (chill) / Sleep ZZZ */}
                                                {idleVibe === 'chill' && (
                                                    <div className="absolute top-10 left-1/2 -translate-x-1/2 w-32 h-12 flex justify-between px-2 text-2xl opacity-80 pointer-events-none">
                                                        <div className="rotate-[-45deg] animate-bounce">🙌</div>
                                                        <div className="absolute -top-10 right-0 font-bold text-blue-400 zzz select-none">Zzz</div>
                                                    </div>
                                                )}

                                                {/* Animated Legs for "Real Cartoon" walking effect */}
                                                {(isWalkingToCooler || isSemenSorting) && (
                                                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-10 h-2 flex justify-between px-1 z-0">
                                                        <div className="w-3 h-3 bg-black rounded-full animate-[legMove_0.3s_infinite_linear]"></div>
                                                        <div className="w-3 h-3 bg-black rounded-full animate-[legMove_0.3s_infinite_linear_delay-150ms]" style={{ animationDelay: '0.15s' }}></div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Professional Name Plate */}
                                            <div className={`mt-4 bg-gray-900 text-white px-5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] border-2 border-[#a35116] shadow-2xl z-20 transition-opacity ${isSemenSorting ? 'opacity-20' : 'opacity-100'}`}>
                                                {agent.name}
                                            </div>
                                            <div className={`text-[9px] font-bold text-gray-500 mt-1 uppercase tracking-widest transition-opacity ${isSemenSorting ? 'opacity-20' : 'opacity-100'}`}>{agent.role}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Footer Info */}
                        <div className="absolute bottom-6 left-12 z-[110] text-[10px] font-black text-[#8b4513] opacity-40 uppercase tracking-[0.3em]">
                            OKKRiteil CRM // Digital Headquarters 1.3
                        </div>
                    </div>
                </div>
            )}

            {view === 'team' ? (
                <div className="relative w-full aspect-[16/9] bg-[#f0e6d2] rounded-[32px] border-8 border-[#4a3728] shadow-2xl overflow-hidden flex flex-col items-center justify-center p-4 cursor-pointer" onClick={() => setIsOfficeOpen(true)}>
                    {/* Floor and Walls Preview */}
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[#d2b48c] border-t-4 border-[#8b4513]"></div>
                    <div className="z-10 text-center">
                        <p className="text-gray-400 font-black uppercase text-xs tracking-widest mb-4">Нажмите, чтобы войти в кабинет</p>
                        <div className="flex gap-4 opacity-50">
                            {agents.map(a => (
                                <img key={a.agent_id} src={`/images/agents/${a.agent_id}.png`} className="h-20 w-auto grayscale" />
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Tabs */}
                    <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
                        {/* Red Tab */}
                        <button
                            onClick={() => setActiveTab(activeTab === 'red' ? null : 'red')}
                            className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'red'
                                ? 'bg-red-50 border-red-200 shadow-lg shadow-red-100'
                                : 'bg-white border-gray-100 hover:border-red-100 hover:bg-red-50/50'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'red' ? 'text-red-600' : 'text-gray-400 group-hover:text-red-500'}`}>Критичные</span>
                                <div className={`w-2 h-2 rounded-full ${activeTab === 'red' ? 'bg-red-500 animate-pulse' : 'bg-red-200'}`}></div>
                            </div>
                            <div className="text-2xl md:text-3xl font-black text-gray-900 mb-1">{stats.red.count}</div>
                            <div className="text-[10px] md:text-xs font-medium text-gray-500">{formatMoney(stats.red.sum)}</div>
                        </button>

                        {/* Yellow Tab */}
                        <button
                            onClick={() => setActiveTab(activeTab === 'yellow' ? null : 'yellow')}
                            className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'yellow'
                                ? 'bg-yellow-50 border-yellow-200 shadow-lg shadow-yellow-100'
                                : 'bg-white border-gray-100 hover:border-yellow-100 hover:bg-yellow-50/50'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'yellow' ? 'text-yellow-600' : 'text-gray-400 group-hover:text-yellow-500'}`}>Внимание</span>
                                <div className={`w-2 h-2 rounded-full ${activeTab === 'yellow' ? 'bg-yellow-400' : 'bg-yellow-200'}`}></div>
                            </div>
                            <div className="text-2xl md:text-3xl font-black text-gray-900 mb-1">{stats.yellow.count}</div>
                            <div className="text-[10px] md:text-xs font-medium text-gray-500">{formatMoney(stats.yellow.sum)}</div>
                        </button>

                        {/* Green Tab */}
                        <button
                            onClick={() => setActiveTab(activeTab === 'green' ? null : 'green')}
                            className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'green'
                                ? 'bg-green-50 border-green-200 shadow-lg shadow-green-100'
                                : 'bg-white border-gray-100 hover:border-green-100 hover:bg-green-50/50'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'green' ? 'text-green-600' : 'text-gray-400 group-hover:text-green-500'}`}>В работе</span>
                                <div className={`w-2 h-2 rounded-full ${activeTab === 'green' ? 'bg-green-500' : 'bg-green-200'}`}></div>
                            </div>
                            <div className="text-2xl md:text-3xl font-black text-gray-900 mb-1">{stats.green.count}</div>
                            <div className="text-[10px] md:text-xs font-medium text-gray-500">{formatMoney(stats.green.sum)}</div>
                        </button>

                        {/* Black Tab */}
                        <button
                            onClick={() => setActiveTab(activeTab === 'black' ? null : 'black')}
                            className={`relative p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all duration-300 text-left group overflow-hidden ${activeTab === 'black'
                                ? 'bg-gray-900 border-gray-700 shadow-lg shadow-gray-400'
                                : 'bg-white border-gray-100 hover:border-gray-400 hover:bg-gray-50'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-black uppercase tracking-widest ${activeTab === 'black' ? 'text-gray-200' : 'text-gray-400 group-hover:text-gray-600'}`}>Нераспред.</span>
                                <div className={`w-2 h-2 rounded-full ${activeTab === 'black' ? 'bg-gray-200' : 'bg-gray-300'}`}></div>
                            </div>
                            <div className={`text-2xl md:text-3xl font-black mb-1 ${activeTab === 'black' ? 'text-white' : 'text-gray-900'}`}>{stats.black.count}</div>
                            <div className={`text-[10px] md:text-xs font-medium ${activeTab === 'black' ? 'text-gray-400' : 'text-gray-500'}`}>{formatMoney(stats.black.sum)}</div>
                        </button>
                    </div>

                    {/* List */}
                    {activeTab && (
                        <div className="space-y-3 min-h-[200px]">
                            {filteredOrders.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-2xl text-gray-300">
                                        ✨
                                    </div>
                                    <p className="text-gray-400 font-medium">Нет сделок в этой категории</p>
                                </div>
                            ) : (
                                filteredOrders.map((order) => (
                                    <div key={order.orderId} className="group p-4 md:p-5 rounded-2xl md:rounded-3xl border border-gray-100 hover:border-blue-200 bg-gray-50/30 hover:bg-white transition-all duration-300 hover:shadow-lg cursor-pointer">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:mb-2">
                                            <div className="flex items-center gap-3 md:gap-4">
                                                <div className={`w-1.5 md:w-2 h-10 md:h-12 rounded-full flex-shrink-0 ${order.level === 'red' ? 'bg-red-500' :
                                                    order.level === 'yellow' ? 'bg-yellow-400' :
                                                        order.level === 'green' ? 'bg-green-500' : 'bg-gray-800'
                                                    }`}></div>
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-1">
                                                        <a
                                                            href={crmUrl ? `${crmUrl}/orders/${order.orderId}/edit` : '#'}
                                                            target={crmUrl ? '_blank' : undefined}
                                                            className="font-black text-gray-900 text-base md:text-lg hover:text-blue-600 hover:underline decoration-2 underline-offset-2 transition-colors"
                                                            onClick={e => !crmUrl && e.preventDefault()}
                                                        >
                                                            #{order.orderNumber}
                                                        </a>
                                                        <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-white px-2 py-0.5 rounded-lg border border-gray-100">
                                                            {order.managerName}
                                                        </span>
                                                        {order.status && (
                                                            <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                                                                {order.status}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs md:text-sm font-medium text-gray-500">
                                                        {formatMoney(order.totalSum)}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-row md:flex-col items-center md:items-end flex-wrap gap-2">
                                                <button
                                                    onClick={(e) => handleAnalyze(e, order.orderId)}
                                                    disabled={analyzingOrderId === order.orderId}
                                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95 flex items-center gap-2 ${analyzingOrderId === order.orderId
                                                        ? 'bg-gray-100 text-gray-400 animate-pulse'
                                                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                                                        }`}
                                                >
                                                    {analyzingOrderId === order.orderId ? (
                                                        'Анализ...'
                                                    ) : (
                                                        <>
                                                            <img src="/images/agents/anna.png" alt="Anna" className="w-5 h-5 rounded-full border border-white/30" />
                                                            <span>Анна: ИИ разбор</span>
                                                        </>
                                                    )}
                                                </button>
                                                <div className="flex flex-row md:flex-col items-center md:items-end flex-wrap gap-1.5">
                                                    {order.reasons.filter((r: string) => !r.startsWith('AI:')).map((r: string, i: number) => (
                                                        <div key={i} className={`text-[9px] md:text-[10px] font-bold px-2 py-0.5 md:py-1 rounded-lg ${order.level === 'red' ? 'text-red-500 bg-red-50' :
                                                            order.level === 'yellow' ? 'text-yellow-600 bg-yellow-50' :
                                                                order.level === 'green' ? 'text-green-500 bg-green-50' :
                                                                    'text-gray-500 bg-gray-100'
                                                            }`}>
                                                            {r}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        {/* AI Resume & Recommendation Section */}
                                        <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {order.summary && order.summary !== 'Ожидание анализа' && (
                                                <div className="flex items-center gap-2">
                                                    <img src="/images/agents/anna.png" alt="Anna" className="w-8 h-8 rounded-full border-2 border-purple-100 shadow-sm" />
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-purple-500 mb-0.5">Анна: Резюме</p>
                                                        <p className="text-sm font-medium text-gray-700 italic">"{order.summary}"</p>
                                                    </div>
                                                </div>
                                            )}

                                            {order.recommendedAction && (
                                                <div className="flex items-start gap-3">
                                                    <span className="text-lg">💡</span>
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-1">Рекомендация</p>
                                                        <p className="text-sm font-medium text-gray-700">{order.recommendedAction}</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Deep Analysis Result (if available) */}
                                        {analysisResults[order.orderId] && (
                                            <div className="mt-4 p-4 md:p-5 bg-indigo-50/50 rounded-2xl md:rounded-3xl border border-indigo-100 animate-in fade-in slide-in-from-top-2 duration-500">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                    {/* LPR & Core */}
                                                    <div className="space-y-4">
                                                        <div>
                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">ЛПР / Роль</p>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-bold text-gray-900">
                                                                    {analysisResults[order.orderId].lpr?.name || 'Не выявлен'}
                                                                </span>
                                                                {analysisResults[order.orderId].lpr?.role && (
                                                                    <span className="text-[10px] bg-white px-2 py-0.5 rounded-md border border-indigo-100 text-indigo-600 font-bold">
                                                                        {analysisResults[order.orderId].lpr.role}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Бюджет / Сроки</p>
                                                            <p className="text-xs font-medium text-gray-600">
                                                                💰 {analysisResults[order.orderId].budget?.status || 'Неизвестно'}
                                                                {analysisResults[order.orderId].budget?.constraints && ` (${analysisResults[order.orderId].budget.constraints})`}
                                                            </p>
                                                            <p className="text-xs font-medium text-gray-600 mt-1">
                                                                ⏳ {analysisResults[order.orderId].timeline?.urgency === 'hot' ? '🔥 Срочно' : analysisResults[order.orderId].timeline?.urgency === 'low' ? '💨 Не горит' : '📅 Нормально'}
                                                            </p>
                                                        </div>
                                                        {analysisResults[order.orderId].dialogue_count !== undefined && (
                                                            <div className="pt-2 border-t border-indigo-100">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-1">Коммуникация</p>
                                                                <p className="text-xs font-bold text-gray-700">
                                                                    📞 {analysisResults[order.orderId].dialogue_count} звонков
                                                                </p>
                                                                {analysisResults[order.orderId].last_contact_date && (
                                                                    <p className="text-[9px] text-gray-400 mt-0.5">
                                                                        Контакт: {new Date(analysisResults[order.orderId].last_contact_date).toLocaleDateString('ru-RU')}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Pain Points & Technical */}
                                                    <div className="space-y-4">
                                                        <div>
                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Боли клиента</p>
                                                            <div className="flex flex-wrap gap-1">
                                                                {analysisResults[order.orderId].pain_points?.map((p: string, i: number) => (
                                                                    <span key={i} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-md font-medium border border-red-100 italic">
                                                                        {p}
                                                                    </span>
                                                                )) || <span className="text-xs text-gray-400">Не указаны</span>}
                                                            </div>
                                                        </div>
                                                        {analysisResults[order.orderId].dialogue_summary && (
                                                            <div>
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">История диалогов</p>
                                                                <p className="text-[11px] text-gray-600 italic leading-relaxed">
                                                                    {analysisResults[order.orderId].dialogue_summary}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {analysisResults[order.orderId].last_order_changes && (
                                                            <div className="pt-2 border-t border-indigo-100">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-1">Последние изменения</p>
                                                                <p className="text-[10px] text-gray-500 leading-snug">
                                                                    {analysisResults[order.orderId].last_order_changes}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* AI Advice (Recommendations) */}
                                                    <div className="bg-white/80 p-4 rounded-2xl border border-indigo-100 shadow-sm self-start">
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-2">
                                                            <img src="/images/agents/anna.png" alt="Anna" className="w-6 h-6 rounded-full border border-emerald-100" />
                                                            Анна: Советы Консультанта
                                                        </p>
                                                        <ul className="space-y-2">
                                                            {analysisResults[order.orderId].recommendations?.map((r: string, i: number) => (
                                                                <li key={i} className="text-xs font-bold text-gray-900 flex items-start gap-2">
                                                                    <span className="text-emerald-500 text-sm">✓</span>
                                                                    {r}
                                                                </li>
                                                            )) || <li className="text-xs text-gray-400 italic">Анализируем историю...</li>}
                                                        </ul>
                                                    </div>
                                                </div>

                                                {/* Customer Profile Section */}
                                                {analysisResults[order.orderId].customer_profile && (
                                                    <div className="mt-6 pt-5 border-t border-indigo-100">
                                                        <div className="flex flex-col md:flex-row gap-6">
                                                            <div className="flex-1">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-3 flex items-center gap-2">
                                                                    👤 Профиль клиента
                                                                </p>
                                                                <div className="bg-white/40 p-3 rounded-xl border border-indigo-50 space-y-3">
                                                                    {analysisResults[order.orderId].customer_profile?.client_resume && (
                                                                        <div>
                                                                            <p className="text-[11px] text-gray-700 leading-relaxed">
                                                                                {analysisResults[order.orderId].customer_profile.client_resume}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex flex-wrap gap-4">
                                                                        <div>
                                                                            <p className="text-[9px] uppercase font-bold text-gray-400 mb-0.5">Всего заказов</p>
                                                                            <p className="text-sm font-black text-indigo-600">
                                                                                {analysisResults[order.orderId].customer_profile.total_orders || 1}
                                                                            </p>
                                                                        </div>
                                                                        {analysisResults[order.orderId].customer_profile?.perspective && (
                                                                            <div>
                                                                                <p className="text-[9px] uppercase font-bold text-gray-400 mb-0.5">Потенциал</p>
                                                                                <p className="text-sm font-bold text-gray-700">
                                                                                    {analysisResults[order.orderId].customer_profile.perspective}
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {analysisResults[order.orderId].customer_profile?.cross_sell && analysisResults[order.orderId].customer_profile.cross_sell.length > 0 && (
                                                                <div className="md:w-1/3">
                                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-2">
                                                                        🚀 Что ещё предложить
                                                                    </p>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {analysisResults[order.orderId].customer_profile.cross_sell.map((item: string, i: number) => (
                                                                            <span key={i} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-100 font-bold">
                                                                                {item}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </>
            )
            }
        </div >
    );
}

function HomeContent() {
    const searchParams = useSearchParams();
    const q = searchParams.toString();
    const suffix = q ? `?${q}` : '';

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] py-10 md:py-20">
            <h1 className="text-3xl md:text-5xl font-black text-gray-900 mb-2 tracking-tight text-center">Центр Управления</h1>
            <p className="text-gray-400 font-bold uppercase text-[10px] md:text-xs tracking-[0.2em] mb-8 md:mb-12 text-center">OKKRiteilCRM v1.3 + AI</p>

            <PriorityWidget />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 w-full max-w-6xl">

                {/* Morning Sprint Card */}
                <Link href="/efficiency"
                    className="group relative block p-8 md:p-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-all duration-300 transform hover:-translate-y-1"
                >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white/20 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Утренний Спринт</h2>
                    <p className="text-sm md:text-base text-white/70 font-medium leading-relaxed">Ключевые заказы на сегодня. Обработка до 14:00.</p>
                </Link>

                {/* Settings Card */}
                <Link href="/settings"
                    className="group relative block p-8 md:p-10 bg-white border border-gray-100 rounded-[32px] md:rounded-[40px] shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
                >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-gray-900 mb-3 tracking-tight">Настройки</h2>
                    <p className="text-sm md:text-base text-gray-400 font-medium leading-relaxed">Управление статусами, системные настройки и интеграции.</p>
                </Link>

                {/* Analytics Card */}
                <Link href={`/analytics${suffix}`}
                    className="group relative block p-8 md:p-10 bg-gray-900 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-gray-900/20 hover:bg-blue-600 transition-all duration-300 transform hover:-translate-y-1"
                >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white/10 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Аналитика</h2>
                    <p className="text-sm md:text-base text-white/40 font-medium leading-relaxed">Отчеты по эффективности, нарушениям и контроль качества.</p>
                </Link>

            </div>
        </div>
    );
}

export default function HomePage() {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <HomeContent />
        </Suspense>
    );
}
