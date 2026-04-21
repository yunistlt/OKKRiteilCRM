import React from 'react';
import LegalChatPanel from '../components/LegalChatPanel';
import LegalContractUploadPanel from '../components/LegalContractUploadPanel';
import { getLegalKnowledgeSections, getLegalKnowledgeVersion } from '@/lib/legal-consultant-kb';

export default function LegalDashboardPage() {
  const sections = getLegalKnowledgeSections();
  const kbVersion = getLegalKnowledgeVersion();

  return (
    <div className="flex min-h-[90vh] w-full flex-col bg-slate-100 xl:flex-row">
      <main className="flex-1 p-6 xl:p-8">
        <div className="rounded-[28px] bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_32%),linear-gradient(135deg,#0f172a,#1e293b)] p-8 text-white shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">Legal Helpdesk</div>
              <h1 className="mt-3 text-3xl font-black tracking-tight">Юридический дашборд</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-200">
                Рабочий контур для внутренних юридических вопросов: KB-first чат, fallback в ручную эскалацию и контролируемое сокрытие служебного контекста.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">KB version</div>
              <div className="mt-1 text-2xl font-black">v{kbVersion}</div>
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
