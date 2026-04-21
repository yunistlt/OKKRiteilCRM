import React from 'react';
import Link from 'next/link';
import LegalChatPanel from '../components/LegalChatPanel';
import LegalContractUploadPanel from '../components/LegalContractUploadPanel';
import { getLegalKnowledgeSections, getLegalKnowledgeVersion } from '@/lib/legal-consultant-kb';
import { AGENT_PROFILES, AGENT_STATUS_LABELS, AGENT_STATUS_STYLES } from '@/lib/agents-catalog';

export default function LegalDashboardPage() {
  const sections = getLegalKnowledgeSections();
  const kbVersion = getLegalKnowledgeVersion();
  const legalAgents = AGENT_PROFILES.filter((agent) => agent.domain === 'Legal');

  return (
    <div className="flex min-h-[90vh] w-full flex-col bg-slate-100 xl:flex-row">
      <main className="flex-1 p-6 xl:p-8">
        <div className="rounded-[28px] bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_32%),linear-gradient(135deg,#0f172a,#1e293b)] p-8 text-white shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">Legal Helpdesk</div>
              <h1 className="mt-3 text-3xl font-black tracking-tight">Юридический дашборд</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-200">
                Рабочий контур для внутренних юридических вопросов: Дарья ведет KB-first helpdesk, а договорные и риск-кейсы маршрутизируются в специализированные legal-контуры.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">KB version</div>
                <div className="mt-1 text-2xl font-black">v{kbVersion}</div>
              </div>
              <Link
                href="/agents"
                className="rounded-2xl border border-sky-300/30 bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20"
              >
                Открыть каталог всех ИИ-агентов
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {sections.map((section) => (
            <div key={section.key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{section.key}</div>
              <div className="mt-2 text-lg font-bold text-slate-900">{section.title}</div>
              <div className="mt-3 text-sm text-slate-600">Записей в каталоге: {section.itemCount}</div>
            </div>
          ))}
          <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Fallback</div>
            <div className="mt-2 text-lg font-bold text-slate-900">Ручная эскалация</div>
            <div className="mt-3 text-sm leading-6 text-slate-600">
              Если вопрос не покрыт базой знаний или затрагивает суды, санкции, персональные данные или нестандартные redlines, чат предлагает зафиксировать задачу юристу в audit trail.
            </div>
          </div>
        </div>

        <div className="mt-6">
          <LegalContractUploadPanel />
        </div>
      </main>

      <div className="w-full xl:max-w-xl">
        <LegalChatPanel />
      </div>
    </div>
  );
}

        <div className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Legal agents</div>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Команда юридического контура</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Дарья ведет первую линию helpdesk, а Лев, Борис и Григорий закрывают специализированные сценарии redlining, due diligence и претензионной работы.
              </p>
            </div>
            <Link
              href="/agents?domain=Legal"
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
            >
              Открыть весь legal-каталог
            </Link>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {legalAgents.map((agent) => (
              <div key={agent.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <img src={agent.avatarSrc} alt={agent.name} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-black text-slate-900">{agent.name}</div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${AGENT_STATUS_STYLES[agent.status]}`}>
                        {AGENT_STATUS_LABELS[agent.status]}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">{agent.role}</div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{agent.summary}</p>
              </div>
            ))}
          </div>
        </div>
