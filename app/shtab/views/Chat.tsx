'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewProps } from '../nav';
import SettingProposals from './SettingProposals';
import Rich from '../Rich';
import { lookedInto } from '@/lib/shtab/tool-titles';

// Разговор с Тамарой: свои чаты, память и пересказ.
//
// Поле «спроси Тамару» под фигурой слева осталось для короткого вопроса на
// бегу. Здесь — рабочая переписка: видно всю ленту, из чего она собрала ответ,
// что запомнила, и можно вести несколько тем параллельно, не перемешивая их.

type Chat = {
    id: number;
    title: string;
    summary: string;
    summary_upto_id: number | null;
    archived: boolean;
    updated_at: string;
};

type Message = {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    used_tools: Array<{ name: string; args: unknown }> | null;
    created_at: string;
};

type MemoryRow = { id: number; fact: string; kind: string; created_at: string };

type ChatFile = { id: number; title: string; file_name: string; size_bytes: number; has_text: boolean };

/** Глубина размышления. Дороже и дольше — но разбор без шагов не разбор. */
const EFFORTS: Array<{ id: 'low' | 'medium' | 'high'; title: string; hint: string }> = [
    { id: 'low', title: 'быстро', hint: 'короткий ответ, почти без проверок' },
    { id: 'medium', title: 'обычно', hint: 'разбор в несколько запросов' },
    { id: 'high', title: 'глубоко', hint: 'длинная цепочка, сверяет числа с разных сторон' },
];

const KIND_TITLES: Record<string, string> = {
    decision: 'решение',
    context: 'обстоятельство',
    preference: 'как работать',
};

function when(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Chat({ tamara }: ViewProps) {
    const [chats, setChats] = useState<Chat[]>([]);
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [memory, setMemory] = useState<MemoryRow[]>([]);
    const [files, setFiles] = useState<ChatFile[]>([]);
    const [showMemory, setShowMemory] = useState(false);
    const [text, setText] = useState('');
    const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('medium');
    const [busy, setBusy] = useState(false);
    const [recording, setRecording] = useState(false);
    const [decoding, setDecoding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Ответ Тамары мог оставить новое предложение по настройке: перечитываем
    // карточки после каждого захода, иначе оно появится только после перезагрузки.
    const [proposalsKey, setProposalsKey] = useState(0);
    // Какое сообщение только что скопировали — чтобы на кнопке было видно, что
    // нажатие сработало. Без отклика её жмут по три раза.
    const [copied, setCopied] = useState<number | null>(null);
    // Приветствие дня. Приходит отдельно от ленты и в переписку не пишется:
    // это не вопрос и не ответ, и захламлять им историю разговора незачем.
    const [greeting, setGreeting] = useState<string | null>(null);
    // Какое сообщение раскрыто по вопросу «откуда это». Номер, а не флаг:
    // открытых окон одно, и открытие второго закрывает первое само собой.
    const [sources, setSources] = useState<number | null>(null);
    const feedRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const chunks = useRef<Blob[]>([]);

    const loadChats = useCallback(async () => {
        const res = await fetch('/api/shtab/tamara/chats');
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Список разговоров не открылся');
        setChats(data.chats ?? []);
        return (data.chats ?? []) as Chat[];
    }, []);

    const loadFiles = useCallback(async (chatId: number | null) => {
        if (!chatId) return setFiles([]);
        const res = await fetch(`/api/shtab/tamara/files?chat_id=${chatId}`);
        const data = await res.json();
        setFiles(res.ok ? data.files ?? [] : []);
    }, []);

    const openChat = useCallback(
        async (id: number | null) => {
            const url = id ? `/api/shtab/tamara?chat_id=${id}` : '/api/shtab/tamara';
            const res = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Разговор не открылся');
            setChat(data.chat ?? null);
            setMessages(data.messages ?? []);
            await loadFiles(data.chat?.id ?? null);
        },
        [loadFiles],
    );

    const attach = useCallback(
        async (file: File) => {
            setBusy(true);
            setError(null);
            try {
                const body = new FormData();
                body.append('file', file);
                if (chat?.id) body.append('chat_id', String(chat.id));
                const res = await fetch('/api/shtab/tamara/files', { method: 'POST', body });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || 'Файл не прицепился');
                if (!chat) await openChat(data.chat_id);
                await loadFiles(data.chat_id);
                if (!data.has_text) {
                    setError('Файл сохранён, но текст из него не извлёкся — Тамара его не прочитает.');
                }
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setBusy(false);
                if (fileRef.current) fileRef.current.value = '';
            }
        },
        [chat, openChat, loadFiles],
    );

    // ── диктовка ──────────────────────────────────────────────────────────────
    // Пишем на устройстве и отправляем запись на распознавание — тем же путём,
    // которым распознаются звонки. Текст попадает в поле ввода, а не уходит
    // сразу: надиктованное почти всегда надо поправить.
    const startRecording = useCallback(async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const rec = new MediaRecorder(stream);
            chunks.current = [];
            rec.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.current.push(e.data);
            };
            rec.onstop = async () => {
                // Дорожку надо закрыть руками, иначе в браузере остаётся
                // гореть значок микрофона, хотя запись уже кончилась.
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
                if (blob.size === 0) return;
                setDecoding(true);
                try {
                    const body = new FormData();
                    body.append('audio', blob, 'dictation.webm');
                    const res = await fetch('/api/shtab/tamara/voice', { method: 'POST', body });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data?.error || 'Не распозналось');
                    setText((prev) => (prev.trim() ? `${prev.trim()} ${data.text}` : data.text));
                } catch (e) {
                    setError((e as Error).message);
                } finally {
                    setDecoding(false);
                }
            };
            rec.start();
            recorder.current = rec;
            setRecording(true);
        } catch (e) {
            setError(`Микрофон не открылся: ${(e as Error).message}`);
        }
    }, []);

    const stopRecording = useCallback(() => {
        recorder.current?.stop();
        recorder.current = null;
        setRecording(false);
    }, []);

    const detach = useCallback(
        async (id: number) => {
            await fetch(`/api/shtab/tamara/files/${id}`, { method: 'DELETE' });
            await loadFiles(chat?.id ?? null);
        },
        [chat, loadFiles],
    );

    const loadMemory = useCallback(async () => {
        const res = await fetch('/api/shtab/tamara/memory');
        const data = await res.json();
        if (res.ok) setMemory(data.memory ?? []);
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const list = await loadChats();
                if (!alive) return;
                await openChat(list[0]?.id ?? null);
                await loadMemory();
                // Здоровается не спеша и не мешая: лента уже открыта, а
                // приветствие приезжает, когда сочинится.
                fetch('/api/shtab/tamara/greeting')
                    .then((r) => r.json())
                    .then((j) => {
                        if (alive && j?.greeting) setGreeting(String(j.greeting));
                    })
                    .catch(() => undefined);
            } catch (e) {
                if (alive) setError((e as Error).message);
            }
        })();
        return () => {
            alive = false;
        };
    }, [loadChats, openChat, loadMemory]);

    // Лента листается вниз сама: разговор читается от старых реплик к новым,
    // и после ответа смотреть надо на последнюю.
    useEffect(() => {
        const el = feedRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, busy]);

    const send = useCallback(async () => {
        const question = text.trim();
        if (!question || busy) return;
        setBusy(true);
        setError(null);
        setText('');
        // Вопрос показывается сразу, до ответа: ждать минуту, глядя на пустое
        // поле, нельзя — непонятно, ушло ли вообще.
        setMessages((prev) => [
            ...prev,
            { id: -Date.now(), role: 'user', text: question, used_tools: [], created_at: new Date().toISOString() },
        ]);
        tamara.say('Думаю.', undefined, 'thinking');
        try {
            const res = await fetch('/api/shtab/tamara', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, chat_id: chat?.id, effort }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `Ответ ${res.status}`);
            await Promise.all([loadChats(), openChat(data.chat_id)]);
            if (data.digest?.remembered) await loadMemory();
            setProposalsKey((k) => k + 1);
            tamara.say(
                data.reply || 'Пусто.',
                data.used_tools?.length ? `Смотрела: ${data.used_tools.join(', ')}.` : undefined,
                'explain',
            );
        } catch (e) {
            setError((e as Error).message);
            setText(question);
            setMessages((prev) => prev.filter((m) => m.id > 0));
        } finally {
            setBusy(false);
        }
    }, [text, busy, chat, effort, tamara, loadChats, openChat, loadMemory]);

    const newChat = useCallback(async () => {
        const res = await fetch('/api/shtab/tamara/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) return setError(data?.error || 'Не завёлся');
        await loadChats();
        setChat(data);
        setMessages([]);
        setFiles([]);
    }, [loadChats]);

    const rename = useCallback(
        async (c: Chat) => {
            const title = window.prompt('Название разговора', c.title);
            if (!title?.trim()) return;
            await fetch(`/api/shtab/tamara/chats/${c.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim() }),
            });
            await loadChats();
            if (chat?.id === c.id) setChat({ ...chat, title: title.trim() });
        },
        [chat, loadChats],
    );

    const archive = useCallback(
        async (c: Chat) => {
            await fetch(`/api/shtab/tamara/chats/${c.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived: true }),
            });
            const list = await loadChats();
            if (chat?.id === c.id) await openChat(list[0]?.id ?? null);
        },
        [chat, loadChats, openChat],
    );

    const forget = useCallback(
        async (id: number) => {
            await fetch(`/api/shtab/tamara/memory/${id}`, { method: 'DELETE' });
            await loadMemory();
        },
        [loadMemory],
    );

    return (
        <>
            {/* Заголовок раздела на телефоне не показывается: то же слово уже
                стоит во вкладках, а место он занимает в треть экрана. */}
            <div className="view-head chat-head-block">
                <div className="eyebrow">Наставник</div>
                <h1>Разговор</h1>
                {/* Пояснение к разделу читают один раз, а место на телефоне
                    оно отнимает всегда — там его нет. */}
                <p className="chat-intro">
                    Рабочая переписка с Тамарой. Разговоры отдельные, чтобы темы не мешались; что сказано — она помнит
                    и в следующий раз, а числа каждый раз смотрит заново.
                </p>
            </div>

            {error ? (
                <div className="card" style={{ borderColor: 'var(--signal)', marginBottom: 14 }}>
                    <span className="eyebrow" style={{ color: 'var(--signal)' }}>не вышло</span>
                    <p style={{ marginTop: 6 }}>{error}</p>
                </div>
            ) : null}

            <div className="chat">
                <aside className="chat-list">
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => void newChat()}>
                        новый разговор
                    </button>
                    {chats.length === 0 ? <p className="hint">Разговоров ещё нет.</p> : null}
                    {chats.map((c) => (
                        <div key={c.id} className={`chat-item${chat?.id === c.id ? ' on' : ''}`}>
                            <button className="chat-pick" onClick={() => void openChat(c.id)}>
                                <span className="chat-title">{c.title}</span>
                                <span className="eyebrow">{when(c.updated_at)}</span>
                            </button>
                            <div className="chat-ops">
                                <button className="btn btn-sm" onClick={() => void rename(c)}>
                                    имя
                                </button>
                                <button className="btn btn-sm" onClick={() => void archive(c)}>
                                    в архив
                                </button>
                            </div>
                        </div>
                    ))}
                </aside>

                <section className="chat-main">
                    {/* Шапка и лента тем — только для телефона.
                        Шапка отвечает на вопрос «с кем я говорю»: на узком
                        экране собеседника показывают лицом в кружке, а не
                        ростовым портретом на полэкрана.
                        Лента тем — способ попасть в нужный разговор за одно
                        касание. Список колонкой на телефоне не помещается, а
                        кружок с буквой узнаётся быстрее строки текста. */}
                    <div className="chat-bar chat-mobile-only">
                        <img className="chat-ava" src="/images/tamara/face.webp" alt="" />
                        <div className="chat-who">
                            <b>Тамара</b>
                            <span className="eyebrow">{chat?.title ?? 'новый разговор'}</span>
                        </div>
                        <button className="chat-plus" onClick={() => void newChat()} title="новый разговор">
                            +
                        </button>
                    </div>

                    <div className="chat-strip chat-mobile-only">
                        {chats.map((c) => (
                            <button
                                key={c.id}
                                className={`chat-chip${chat?.id === c.id ? ' on' : ''}`}
                                onClick={() => void openChat(c.id)}
                            >
                                {/* Цвет кружка — от номера разговора: один и тот
                                    же разговор всегда одного цвета, и рука
                                    находит его быстрее, чем глаз дочитывает. */}
                                <span className="chat-chip-ico" data-tone={c.id % 5}>
                                    {(c.title || '?').trim().charAt(0).toUpperCase()}
                                </span>
                                <span className="chat-chip-name">{c.title}</span>
                            </button>
                        ))}
                    </div>

                    {chat?.summary ? (
                        <details className="chat-summary">
                            <summary className="eyebrow">Что было раньше в этом разговоре</summary>
                            <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--ink-2)' }}>{chat.summary}</p>
                        </details>
                    ) : null}

                    <div className="chat-feed" ref={feedRef}>
                        {/* Приветствие дня стоит первым в ленте, а не всплывает
                            поверх: это её реплика, и место ей там же, где
                            остальные, — иначе её закрывают не читая. */}
                        {greeting ? (
                            <div className="chat-msg assistant">
                                <div className="chat-head">
                                    <span className="eyebrow">Тамара · сегодня</span>
                                </div>
                                <Rich text={greeting} />
                            </div>
                        ) : null}
                        {messages.length === 0 && !busy && !greeting ? (
                            <p className="hint">
                                Спроси про область с минусами, про цифры по заводу или про шаг методички — она
                                посмотрит инструментами и ответит по существу.
                            </p>
                        ) : null}
                        {messages.map((m) => (
                            <div key={m.id} className={`chat-msg ${m.role}`}>
                                <div className="chat-head">
                                    <span className="eyebrow">
                                        {m.role === 'user' ? 'ты' : 'Тамара'} · {when(m.created_at)}
                                    </span>
                                    {/* Ответ с таблицей уносят в почту или в чат
                                        с людьми — выделять его мышью по строчке
                                        неудобно, и половину забирают лишнего. */}
                                    <button
                                        className="chat-copy"
                                        title="скопировать"
                                        onClick={() => {
                                            void navigator.clipboard
                                                .writeText(m.text)
                                                .then(() => {
                                                    setCopied(m.id);
                                                    window.setTimeout(() => setCopied(null), 1500);
                                                })
                                                .catch(() => setError('Браузер не дал скопировать'));
                                        }}
                                    >
                                        {copied === m.id ? 'скопировано' : 'копировать'}
                                    </button>
                                </div>
                                {/* Разметку показываем разметкой: таблица из
                                    палок и звёздочек нечитаема, а именно в ней
                                    приходят числа, ради которых всё и затеяно. */}
                                {m.role === 'assistant' ? (
                                    <Rich text={m.text} />
                                ) : (
                                    <div className="chat-text">{m.text}</div>
                                )}
                                {/* Откуда взяты числа — по касанию, а не строкой
                                    под каждым ответом. Строка стояла всегда, а
                                    нужна в одном ответе из десяти: остальные
                                    девять раз она просто отодвигала переписку. */}
                                {m.role === 'assistant' && m.used_tools?.length ? (
                                    <button className="chat-src" onClick={() => setSources(m.id)}>
                                        откуда это
                                    </button>
                                ) : null}
                            </div>
                        ))}
                        {busy ? <div className="chat-msg assistant chat-wait">думает…</div> : null}
                    </div>

                    {/* Предложения по настройкам — над полем ввода, а не в ленте:
                        решение по ним принимают сейчас, а лента уезжает вверх. */}
                    <SettingProposals key={proposalsKey} />

                    <div className="chat-send">
                        {files.length ? (
                            <div className="chat-files">
                                {files.map((f) => (
                                    <span className="chat-file" key={f.id}>
                                        {f.title}
                                        {f.has_text ? null : <b style={{ color: 'var(--signal)' }}> без текста</b>}
                                        <button className="chat-file-x" onClick={() => void detach(f.id)} title="убрать">
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {/* Вся строка ввода: скрепка, глубина, поле, микрофон,
                            отправка. Ничего не спрятано под «ещё» — всё, что
                            нужно при наборе вопроса, стоит на виду и достаётся
                            одним касанием. */}
                        <div className="chat-compose">
                            <input
                                ref={fileRef}
                                type="file"
                                hidden
                                accept=".pdf,.doc,.docx,.txt,.csv,.tsv,.xlsx,.xls"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) void attach(f);
                                }}
                            />
                            {/* Скрепка — знак вложения во всех мессенджерах,
                                объяснять его не нужно. */}
                            <button
                                className="chat-ico"
                                disabled={busy}
                                onClick={() => fileRef.current?.click()}
                                title="прицепить файл"
                                aria-label="прицепить файл"
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                    <path
                                        d="M20 11.5 11.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>

                            {/* Глубина: списком на телефоне, кнопками на
                                широком экране. Список занимает место одной
                                кнопки и показывает выбранное значение на себе. */}
                            <select
                                className="chat-deep chat-mobile-only"
                                value={effort}
                                onChange={(e) => setEffort(e.target.value as 'low' | 'medium' | 'high')}
                                aria-label="Глубина размышления"
                            >
                                {EFFORTS.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.title}
                                    </option>
                                ))}
                            </select>
                            {EFFORTS.map((e) => (
                                <button
                                    key={e.id}
                                    className={`btn btn-sm chat-desk-only${effort === e.id ? ' btn-primary' : ''}`}
                                    title={e.hint}
                                    onClick={() => setEffort(e.id)}
                                >
                                    {e.title}
                                </button>
                            ))}

                        <textarea
                            value={text}
                            placeholder="Что спросить"
                            onChange={(e) => {
                                setText(e.target.value);
                                // Рост по тексту. Высоту сбрасываем перед
                                // замером: иначе поле только растёт и после
                                // стирания текста остаётся раздутым.
                                const el = e.target;
                                el.style.height = '';
                                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                            }}
                            onKeyDown={(e) => {
                                // Enter отправляет, Shift+Enter переносит строку:
                                // вопросы тут чаще в одну строку, чем в абзац.
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void send();
                                }
                            }}
                        />
                            {/* Микрофон — диктовка. Состояние видно по самому
                                значку: идёт запись — он красный, идёт
                                расшифровка — точки. */}
                            <button
                                className={`chat-ico chat-mic${recording ? ' on' : ''}`}
                                disabled={decoding}
                                onClick={() => (recording ? stopRecording() : void startRecording())}
                                title={decoding ? 'расшифровываю' : recording ? 'закончить диктовку' : 'диктовать'}
                                aria-label={decoding ? 'расшифровываю' : recording ? 'закончить диктовку' : 'диктовать'}
                            >
                                {decoding ? (
                                    <span className="dots">
                                        <i />
                                        <i />
                                        <i />
                                    </span>
                                ) : (
                                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                        <path
                                            d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"
                                            fill="currentColor"
                                        />
                                        <path
                                            d="M5 11a7 7 0 0 0 14 0M12 18v3"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        />
                                    </svg>
                                )}
                            </button>

                            <button
                                className="btn btn-primary chat-go"
                                disabled={busy || !text.trim()}
                                onClick={() => void send()}
                                title="спросить"
                                aria-label="спросить"
                            >
                                {/* На телефоне стрелка вместо слова: пять мест
                                    в строке из пяти, и на подпись их не
                                    хватает. На широком экране слово остаётся. */}
                                <span className="chat-desk-only">{busy ? 'думает…' : 'спросить'}</span>
                                <svg
                                    className="chat-mobile-only"
                                    viewBox="0 0 24 24"
                                    width="18"
                                    height="18"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M4 12h14M12 5l7 7-7 7"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            {/* Откуда взяты числа. Выезжает снизу и закрывается касанием мимо —
                так устроены все всплывающие окна на телефоне, и палец ищет
                выход там, где привык. */}
            {sources !== null ? (
                <div className="chat-sheet-back" onClick={() => setSources(null)}>
                    <div className="chat-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="chat-sheet-head">
                            <span className="eyebrow">Откуда это</span>
                            <button className="chat-plus" onClick={() => setSources(null)} title="закрыть">
                                ×
                            </button>
                        </div>
                        <ul className="chat-sheet-list">
                            {lookedInto(messages.find((m) => m.id === sources)?.used_tools).map((t) => (
                                <li key={t}>{t}</li>
                            ))}
                        </ul>
                        <p className="hint">
                            Числа в ответе взяты отсюда. Любое из них она раскладывает до исходных строк — спроси
                            «откуда 34 заказа», и она покажет.
                        </p>
                    </div>
                </div>
            ) : null}

            {/* Память — справочный раздел, к ней приходят разбираться, а не
                переписываться. На телефоне она целиком скрыта: всё, что стоит
                под перепиской, заставляет страницу прокручиваться, и тогда
                прокруток снова становится две. */}
            <div className="chat-memory">
                <div className="block-label">
                    <span className="eyebrow">Память · {memory.length}</span>
                    <button className="btn btn-sm" onClick={() => setShowMemory((v) => !v)}>
                        {showMemory ? 'свернуть' : 'показать'}
                    </button>
                </div>
                <p className="hint" style={{ marginBottom: 10 }}>
                    То, что Тамара держит в голове между разговорами: решения, обстоятельства, как с тобой работать.
                    Чисел тут нет — они устаревают, их она смотрит заново. Лишнее можно забыть.
                </p>
                {showMemory ? (
                    <div className="stack" style={{ gap: 8 }}>
                        {memory.length === 0 ? <p className="hint">Пока пусто.</p> : null}
                        {memory.map((m) => (
                            <div className="chat-mem" key={m.id}>
                                <span className="eyebrow">{KIND_TITLES[m.kind] ?? m.kind}</span>
                                <span>{m.fact}</span>
                                <button className="btn btn-sm btn-danger" onClick={() => void forget(m.id)}>
                                    забыть
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </>
    );
}
