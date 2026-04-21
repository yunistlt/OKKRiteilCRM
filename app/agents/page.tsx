import Link from 'next/link';
import {
    AGENT_DOMAINS,
    AGENT_PROFILES,
    AGENT_STATUS_LABELS,
    AGENT_STATUS_STYLES,
    AgentProfile,
} from '@/lib/agents-catalog';

// Чистка файла: удалены все возможные артефакты, незавершённые выражения, лишние символы (=>, ->, legalAgents.map и т.д.). Весь JSX завершён корректно.
import { getLegalPromptConfig } from '@/lib/legal-consultant-ai';
import { getConsultantPromptConfig } from '@/lib/okk-consultant-ai';

type AgentsPageProps = {
    searchParams?: Promise<{ domain?: string }>;
};

export default async function AgentsDirectoryPage({ searchParams }: AgentsPageProps) {
    const resolvedSearchParams = await searchParams;
    const activeDomain = AGENT_DOMAINS.includes(resolvedSearchParams?.domain as any)
        ? resolvedSearchParams?.domain as (typeof AGENT_DOMAINS)[number]
        : 'all';

    // Агентов, для которых нужен runtime prompt fetch
    const RUNTIME_PROMPT_AGENTS: Record<string, { type: 'legal' | 'consultant', key: string }> = {
        darya: { type: 'legal', key: 'legal_consultant_main_chat' },
        lev: { type: 'legal', key: 'legal_consultant_main_chat' },
    };

    // Получаем runtime prompts параллельно
    const agentPromptEntries = await Promise.all(
        Object.entries(RUNTIME_PROMPT_AGENTS).map(async ([agentId, { type, key }]) => {
            if (type === 'legal') {
                const config = await getLegalPromptConfig(key as any);
                return [agentId, {
                    prompt: config.systemPrompt,
                    isDefault: !config || !config.systemPrompt || config.systemPrompt === '',
                }];
            } else if (type === 'consultant') {
                const config = await getConsultantPromptConfig(key as any);
                return [agentId, {
                    prompt: config.systemPrompt,
                    isDefault: !config || !config.systemPrompt || config.systemPrompt === '',
                }];
            }
            return [agentId, { prompt: '', isDefault: true }];
        })
    );
    const runtimePromptResults: Record<string, { prompt: string; isDefault: boolean }> = Object.fromEntries(agentPromptEntries);

    const visibleAgents = activeDomain === 'all'
        ? AGENT_PROFILES
        : AGENT_PROFILES.filter((agent) => agent.domain === activeDomain);

    // Подменяем promptText для runtime-агентов
    const visibleAgentsWithPrompts: AgentProfile[] = visibleAgents.map((agent) => {
        if (runtimePromptResults[agent.id]) {
            return {
                ...agent,
                promptText: runtimePromptResults[agent.id].prompt,
                promptSourceLabel: runtimePromptResults[agent.id].isDefault ? 'DEFAULT_LEGAL_PROMPTS' : 'ai_prompts (runtime)',
            };
        }
        return agent;
    });

    const groupedAgents = AGENT_DOMAINS.map((domain) => ({
        domain,
        agents: visibleAgentsWithPrompts.filter((agent) => agent.domain === domain),
    })).filter((group) => group.agents.length > 0);

    return (
        <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.12),_transparent_24%),linear-gradient(180deg,#f8fafc,#eef2ff)] px-6 py-8 md:px-8">
            <section className="rounded-[32px] border border-slate-200 bg-white/80 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <div className="text-xs font-black uppercase tracking-[0.28em] text-sky-700">Agent Directory</div>
                        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 md:text-5xl">Все ИИ-агенты OKKRiteilCRM</h1>
                        <p className="mt-4 text-sm leading-7 text-slate-600 md:text-base">
                            Единая страница ролей, связей и prompt contracts. Здесь собраны production-агенты, foundation-контуры и запланированные доменные агенты, включая юридический отдел.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Всего агентов</div>
                            <div className="mt-2 text-3xl font-black text-slate-900">{visibleAgents.length}</div>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">Production</div>
                            <div className="mt-2 text-3xl font-black text-emerald-900">{AGENT_PROFILES.filter((agent) => agent.status === 'production').length}</div>
                        </div>
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700">Legal pipeline</div>
                            <div className="mt-2 text-3xl font-black text-amber-900">{AGENT_PROFILES.filter((agent) => agent.domain === 'Legal').length}</div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="mt-6 rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Фильтр доменов</div>
                        <div className="mt-2 text-sm text-slate-600">Отфильтруйте каталог по продуктовым направлениям и перейдите в рабочие разделы прямо из карточек.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href="/agents"
                            className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition ${activeDomain === 'all' ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-sky-700'}`}
                        >
                            Все
                        </Link>
                        {AGENT_DOMAINS.map((domain) => (
                            <Link
                                key={domain}
                                href={`/agents?domain=${encodeURIComponent(domain)}`}
                                className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition ${activeDomain === domain ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-sky-700'}`}
                            >
                                {domain}
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            <div className="mt-8 space-y-8">
                {groupedAgents.map((group) => (
                    <section key={group.domain} className="space-y-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Домен</div>
                                <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{group.domain}</h2>
                            </div>
                            <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                {group.agents.length} карточек
                            </div>
                        </div>

                        <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-3">
                            {group.agents.map((agent) => (
                                <article
                                    key={agent.id}
                                    className="flex h-full flex-col rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.07)]"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="h-20 w-20 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100 shadow-sm">
                                            <img src={agent.avatarSrc} alt={agent.name} className="h-full w-full object-cover" />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-2xl font-black tracking-tight text-slate-950">{agent.name}</h3>
                                                <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${AGENT_STATUS_STYLES[agent.status]}`}>
                                                    {AGENT_STATUS_LABELS[agent.status]}
                                                </span>
                                            </div>
                                            <div className="mt-2 text-sm font-bold text-sky-800">{agent.role}</div>
                                            <p className="mt-3 text-sm leading-6 text-slate-600">{agent.summary}</p>
                                        </div>
                                    </div>

                                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Должностной контур</div>
                                        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                                            {agent.responsibilities.map((responsibility) => (
                                                <li key={responsibility} className="flex gap-2">
                                                    <span className="mt-1 text-sky-600">•</span>
                                                    <span>{responsibility}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Взаимосвязи</div>
                                        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                                            {agent.connections.map((connection) => (
                                                <li key={connection} className="flex gap-2">
                                                    <span className="mt-1 text-emerald-600">•</span>
                                                    <span>{connection}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-4 text-white">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{agent.promptLabel}</div>
                                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
                                                {agent.domain}
                                            </div>
                                        </div>
                                        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-100">{agent.promptText}</pre>
                                        {agent.promptSourceLabel ? (
                                            <div className="mt-4 border-t border-white/10 pt-4 text-xs text-slate-300">
                                                <span className="font-black uppercase tracking-[0.18em] text-slate-500">Источник</span>
                                                {agent.promptSourceHref ? (
                                                    <Link href={agent.promptSourceHref} className="ml-3 font-semibold text-sky-300 transition hover:text-sky-200">
                                                        {agent.promptSourceLabel}
                                                    </Link>
                                                ) : (
                                                    <span className="ml-3 font-semibold text-slate-200">{agent.promptSourceLabel}</span>
                                                )}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="mt-4 border-t border-slate-100 pt-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Рабочие разделы</div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {agent.routes.map((route) => (
                                                <Link
                                                    key={`${agent.id}-${route}`}
                                                    href={route}
                                                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
                                                >
                                                    {route}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}