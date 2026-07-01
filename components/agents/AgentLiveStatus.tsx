'use client';

import { useEffect, useState } from 'react';

// Живой статус агента из okk_agent_status + реальный backlog очереди system_jobs.
// Заменяет прежний «операционный» вид «Команда ОКК» на честные данные:
// только реальные сигналы (working/idle, current_task, активность, очередь), без выдуманных %.

export interface AgentLive {
    agent_id: string;
    status: 'idle' | 'working' | 'busy' | 'offline';
    current_task?: string | null;
    last_active_minutes_ago?: number | null;
    stale?: boolean;
    backlog?: { queued: number; processing: number } | null;
}

// Общий стор: один polling-цикл на всю страницу вместо запроса на каждую карточку.
let cache: Record<string, AgentLive> = {};
let started = false;
let refCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach((l) => l());
}

async function poll() {
    try {
        const res = await fetch('/api/agents/status');
        const data = await res.json();
        if (data?.success && Array.isArray(data.agents)) {
            const next: Record<string, AgentLive> = {};
            for (const a of data.agents) next[a.agent_id] = a;
            cache = next;
            notify();
        }
    } catch {
        // молча — деградация без телеметрии
    }
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    refCount += 1;
    if (!started) {
        started = true;
        poll();
        timer = setInterval(poll, 5000);
    }
    return () => {
        listeners.delete(cb);
        refCount -= 1;
        if (refCount <= 0 && timer) {
            clearInterval(timer);
            timer = null;
            started = false;
        }
    };
}

function useAgentLive(agentId: string): AgentLive | null {
    const [, force] = useState(0);
    useEffect(() => subscribe(() => force((n) => n + 1)), []);
    return cache[agentId] || null;
}

function activityLabel(minutes: number | null | undefined): string {
    if (minutes == null) return 'нет данных об активности';
    if (minutes <= 0) return 'активность только что';
    if (minutes < 60) return `активность ${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `активность ${hours} ч назад`;
    const days = Math.floor(hours / 24);
    return `активность ${days} дн назад`;
}

export default function AgentLiveStatus({ agentId }: { agentId: string }) {
    const live = useAgentLive(agentId);

    // Нет записи телеметрии по агенту — честно показываем это, не выдумываем статус.
    if (!live) {
        return (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Живой статус</div>
                <div className="mt-2 text-sm text-slate-400">Телеметрия недоступна — агент не пишет статус в реальном времени.</div>
            </div>
        );
    }

    const working = live.status === 'working';
    const backlog = live.backlog;

    return (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Живой статус</div>
                <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
                        working
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-500'
                    }`}
                >
                    {working ? 'Активен' : 'Ожидание'}
                </span>
            </div>

            <div className="mt-2 text-[11px] font-semibold text-slate-500">{activityLabel(live.last_active_minutes_ago)}</div>

            {working && live.current_task ? (
                <div className="mt-3 flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-emerald-500" />
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Текущая операция</div>
                        <div className="text-sm font-bold leading-tight text-slate-800">{live.current_task}</div>
                    </div>
                </div>
            ) : null}

            {backlog ? (
                <div className="mt-3 flex gap-2 text-[11px] font-bold">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">
                        В очереди: {backlog.queued}
                    </span>
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-800">
                        В работе: {backlog.processing}
                    </span>
                </div>
            ) : (
                <div className="mt-3 text-[11px] font-semibold text-slate-400">Очередь задач: не применимо (не работает через system_jobs)</div>
            )}
        </div>
    );
}
