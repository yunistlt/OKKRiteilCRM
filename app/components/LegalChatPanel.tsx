'use client';

import { FormEvent, useMemo, useState } from 'react';

type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  meta?: {
    fallbackStrategy?: string;
    shouldEscalate?: boolean;
    usedAiFallback?: boolean;
  };
};

const QUICK_PROMPTS = [
  'Можно ли менять NDA без юриста?',
  'Что приложить к возврату перед эскалацией?',
  'Когда по контрагенту нужен ручной legal review?',
  'Какие redlines по договору менеджер не согласует сам?',
];

export default function LegalChatPanel() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalationId, setEscalationId] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);

  const lastAgentMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'agent') || null,
    [messages],
  );

  const sendMessage = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const nextUserMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, nextUserMessage];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setEscalationId(null);
    setLoading(true);

    try {
      const response = await fetch('/api/legal/consultant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: nextMessages.map((message) => ({ role: message.role, text: message.text })),
          context: { source: 'legal_dashboard' },
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось получить ответ');
      }

      setMessages((current) => ([
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          text: data.answer,
          meta: {
            fallbackStrategy: data.fallbackStrategy,
            shouldEscalate: data.shouldEscalate,
            usedAiFallback: data.usedAiFallback,
          },
        },
      ]));
    } catch (requestError: any) {
      setError(requestError?.message || 'Ошибка чата');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendMessage(input);
  };

  const requestEscalation = async () => {
    if (messages.length === 0 || escalating) return;

    setEscalating(true);
    setError(null);

    try {
      const response = await fetch('/api/legal/consultant/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: messages.findLast((message) => message.role === 'user')?.text || 'Юридический вопрос',
          transcript: messages.map((message) => ({ role: message.role, text: message.text })),
          context: { source: 'legal_dashboard' },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось создать задачу');
      }
      setEscalationId(String(data.escalationId || '')); 
    } catch (requestError: any) {
      setError(requestError?.message || 'Ошибка эскалации');
    } finally {
      setEscalating(false);
    }
  };

  return (
    <aside className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl">
      <header className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Юр. помощник</h2>
            <p className="mt-1 text-xs text-slate-500">Агент Александр отвечает по внутренней базе знаний и уводит в ручную эскалацию вне покрытия.</p>
          </div>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">KB-first</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void sendMessage(prompt)}
              disabled={loading}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-white px-5 py-4">
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm italic text-slate-500">
            Нет сообщений. Задайте вопрос по NDA, возвратам, проверке контрагентов или redlines по договору.
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === 'user'
              ? 'ml-10 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white'
              : 'mr-10 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800'}
          >
            <div className="whitespace-pre-wrap">{message.text}</div>
            {message.role === 'agent' && message.meta?.fallbackStrategy ? (
              <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                strategy: {message.meta.fallbackStrategy}
              </div>
            ) : null}
          </div>
        ))}

        {loading ? (
          <div className="mr-10 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Александр ищет ответ в базе знаний...
          </div>
        ) : null}
      </div>

      <footer className="border-t border-slate-200 bg-slate-50 px-5 py-4">
        {lastAgentMessage?.meta?.shouldEscalate || error ? (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">Нужна ручная проверка юристом</div>
            <div className="mt-1 text-amber-800">Используйте эскалацию, если вопрос вышел за рамки базы знаний или затрагивает судебные/штрафные риски.</div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void requestEscalation()}
                disabled={escalating}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {escalating ? 'Фиксирую...' : 'Создать задачу юристу'}
              </button>
              {escalationId ? <span className="text-xs font-medium text-amber-900">ID эскалации: {escalationId}</span> : null}
            </div>
          </div>
        ) : null}

        {error ? <div className="mb-3 text-sm text-rose-600">{error}</div> : null}

        <form className="flex gap-2" onSubmit={onSubmit}>
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="Ваш юридический вопрос..."
            disabled={loading}
          />
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading || !input.trim()}
          >
            Отправить
          </button>
        </form>
      </footer>
    </aside>
  );
}
