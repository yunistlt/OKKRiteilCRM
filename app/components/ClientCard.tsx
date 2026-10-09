'use client';

// Карточка клиента: кто это, его реквизиты, связанные карточки того же юрлица
// и все его заказы. Реквизиты в RetailCRM лежат на заказе, поэтому под ними
// подписано, из какого заказа они взяты — число должно раскладываться.
import { useCallback, useEffect, useRef, useState } from 'react';
import ClientFiles from '@/app/components/ClientFiles';
import { useRouter } from 'next/navigation';
import { formatIntRu, formatRub } from '@/lib/format';
import { isReseller } from '@/lib/own-crm/okved';
import { sameCompany } from '@/lib/own-crm/same-company';
import OrderNumberLink from '@/components/ui/OrderNumberLink';
import CompanyGroupPanel from '@/components/clients/CompanyGroupPanel';

type Requisites = {
    contragentType?: string | null;
    fullName?: string | null;
    signerName?: string | null;
    signerTitle?: string | null;
    signerBasis?: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn?: string | null;
    ogrnip?: string | null;
    legalName: string | null;
    legalAddress: string | null;
    bank?: string | null;
    bankAccount?: string | null;
    bik?: string | null;
    corrAccount?: string | null;
    bankAddress?: string | null;
    /** Откуда показаны: карточка клиента, последний заказ или ничего. */
    source?: 'client' | 'order' | 'none';
    fromOrderNumber: string | null;
    updatedAt?: string | null;
    updatedBy?: string | null;
};

type Relation = {
    stage: string | null;
    okved_code: string | null;
    activity: string | null;
    region: string | null;
    company_status: string | null;
    branches: number | null;
    potential: string | number | null;
    next_contact_at: string | null;
    last_touch_at: string | null;
};

type Related = {
    customerId: string;
    name: string | null;
    ordersCount: number | null;
    totalSumm: number | null;
    reason: string;
};

type ContactRow = {
    id: number;
    name: string | null;
    phones: string[];
    email: string | null;
    ordersCount: number;
    lastOrderAt: string | null;
};

/** Правка человека: ФИО, телефон и почта правятся в ОКК (решение владельца 02.10.2026). */
type PersonDraft = {
    lastName: string;
    firstName: string;
    patronymic: string;
    email: string;
    /** Телефонов у человека бывает несколько: рабочий, мобильный, приёмная. */
    phones: string[];
};

type CallRow = {
    at: string;
    direction: string;
    durationSec: number | null;
    managerName: string | null;
    orderNumber: string | null;
    missed: boolean;
    hasRecording: boolean;
};

type EmailRow = {
    at: string;
    from: string | null;
    subject: string | null;
    outcome: string;
    orderNumber: string | null;
};

type OrderRow = {
    orderId: number;
    number: string | null;
    statusName: string | null;
    total: number | null;
    createdAt: string | null;
    managerName: string | null;
};

/** Длительность звонка словами: «1 мин 20 с», а не 80. */
function formatDuration(seconds: number | null) {
    if (!seconds) {
        return 'без разговора';
    }
    if (seconds < 60) {
        return `${seconds} с`;
    }
    return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

function Dash() {
    return <span className="text-gray-300">—</span>;
}

/**
 * Поле на несколько строк, которое растёт под содержимое. Юридический адрес и
 * название организации в одну строку не влезают никогда, а обрезанное значение
 * нельзя проверить глазами (замечание владельца 05.10.2026).
 */
function AutoTextarea({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const ref = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    return (
        <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="w-full resize-y overflow-hidden border border-gray-300 px-2 py-1"
        />
    );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    // Пустое значение показываем прочерком, а не пустотой: по эталону пустая
    // ячейка читается как «забыли показать», а прочерк — как «данных нет».
    const empty = value === null || value === undefined || value === '';

    return (
        <div className="border-b border-gray-100 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
            <div className="text-gray-900">{empty ? <Dash /> : value}</div>
        </div>
    );
}

export default function ClientCard({ clientId }: { clientId: string }) {
    const router = useRouter();
    const [client, setClient] = useState<any>(null);
    const [requisites, setRequisites] = useState<Requisites | null>(null);
    // Реквизиты правятся здесь: они принадлежат заказчику, а в заказ
    // подтягиваются (решение владельца 02.10.2026).
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<Requisites | null>(null);
    /**
     * Чем форма открылась. Нужен, чтобы отправить на сервер ТОЛЬКО поля,
     * которые человек правда менял. Иначе открытая заранее форма сохраняет
     * свой устаревший снимок и затирает то, что внесли за это время, —
     * так пропал ОГРН у ООО «УАС» 09.10.2026.
     */
    const [opened, setOpened] = useState<Requisites | null>(null);
    const [savingRequisites, setSavingRequisites] = useState(false);
    const [requisitesNote, setRequisitesNote] = useState<string | null>(null);
    /**
     * Сбой сохранения. Отдельно от подсказок: его показываем прямо под кнопкой
     * «Сохранить». Раньше любой ответ сервера падал в конец длинной формы —
     * человек жал «Сохранить», ничего не происходило, и он жал ещё раз
     * (жалоба 09.10.2026: «кнопка не работает, снова высвечивается синим»).
     */
    const [requisitesError, setRequisitesError] = useState<string | null>(null);
    const [relation, setRelation] = useState<Relation | null>(null);
    const [related, setRelated] = useState<Related[]>([]);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [calls, setCalls] = useState<CallRow[]>([]);
    const [emails, setEmails] = useState<EmailRow[]>([]);
    const [phone, setPhone] = useState<string | null>(null);
    /**
     * Телефоны компании. Их несколько: приёмная, снабжение, мобильный
     * директора — поэтому список, а не одно поле (просьба менеджеров
     * 08.10.2026). Пустая строка в конце — это поле «добавить ещё».
     */
    const [phones, setPhones] = useState<string[]>([]);
    const [phonesSaving, setPhonesSaving] = useState(false);
    const [phonesNote, setPhonesNote] = useState<string | null>(null);
    const [contacts, setContacts] = useState<ContactRow[]>([]);
    // Правка человека: открыт один контакт за раз.
    const [personEditId, setPersonEditId] = useState<number | null>(null);
    const [personDraft, setPersonDraft] = useState<PersonDraft | null>(null);
    const [personSaving, setPersonSaving] = useState(false);
    const [personNote, setPersonNote] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Реквизиты читаем отдельно: их хозяин — клиент, и правятся они здесь.
    const loadRequisites = useCallback(async () => {
        try {
            const res = await fetch(`/api/clients/${clientId}/requisites`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'реквизиты не прочитались');
            setRequisites(payload.requisites);
        } catch (e: any) {
            // Молчать нельзя: пустые поля человек читает как «данных нет» и
            // вносит их заново — а они на месте, просто не доехали.
            setRequisitesNote(`Реквизиты не загрузились: ${e.message}. Это сбой чтения, данные на месте — обновите страницу.`);
        }
    }, [clientId]);

    /**
     * Заполнить реквизиты по ИНН или из присланной карточки предприятия.
     * Заполняем только пустые поля: то, что менеджер уже вписал руками,
     * затирать нельзя (решение владельца 05.10.2026).
     */
    const [lookupBusy, setLookupBusy] = useState<'inn' | 'file' | null>(null);

    const applyFound = (found: Record<string, any>) => {
        setDraft((current) => {
            const base: any = { ...(current ?? {}) };
            for (const [key, value] of Object.entries(found)) {
                if (!value) continue;
                if (!String(base[key] ?? '').trim()) base[key] = value;
            }
            return base;
        });
    };

    const fillByInn = async () => {
        const inn = String(draft?.inn ?? requisites?.inn ?? '').trim();
        if (!inn) { setRequisitesNote('Сначала впишите ИНН'); return; }

        setLookupBusy('inn');
        setRequisitesNote(null);
        try {
            const res = await fetch('/api/clients/requisites-lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inn }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не нашлось');
            applyFound(payload.requisites ?? {});
            setRequisitesNote(payload.status && payload.status !== 'ACTIVE'
                ? 'Заполнили из реестра. Внимание: компания не действующая — проверьте перед сделкой.'
                : 'Заполнили из реестра. Банк и счёт в реестре не хранятся — впишите их сами.');
        } catch (e: any) {
            setRequisitesNote(e.message);
        } finally {
            setLookupBusy(null);
        }
    };

    const fillFromFile = async (file: File) => {
        setLookupBusy('file');
        setRequisitesNote(null);
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('/api/clients/requisites-from-file', { method: 'POST', body: form });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Файл не разобрался');
            applyFound(payload.requisites ?? {});
            setRequisitesNote(`Из файла заполнено полей: ${payload.filled}. Проверьте счёт и банк — ошибка в них дороже всего.`);
        } catch (e: any) {
            setRequisitesNote(e.message);
        } finally {
            setLookupBusy(null);
        }
    };

    const saveRequisites = async () => {
        if (!draft) return;

        // Отправляем только изменённое: поле, которого нет в запросе, сервер
        // не трогает. Пустая строка здесь — осознанная очистка человеком.
        const fields: Array<keyof Requisites> = [
            'legalName', 'fullName', 'signerName', 'signerTitle', 'signerBasis',
            'inn', 'kpp', 'ogrn', 'ogrnip', 'legalAddress',
            'bank', 'bankAccount', 'bik', 'corrAccount', 'bankAddress', 'contragentType',
        ];
        const changedFields: Record<string, string> = {};
        for (const key of fields) {
            const now = String(draft[key] ?? '');
            const was = String(opened?.[key] ?? '');
            if (now !== was) changedFields[key] = now;
        }

        if (!Object.keys(changedFields).length) {
            setEditing(false);
            setDraft(null);
            setOpened(null);
            return;
        }

        setSavingRequisites(true);
        setRequisitesNote(null);
        setRequisitesError(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/requisites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changedFields),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить реквизиты');
            setRequisites(payload.requisites);
            void loadRequisites();
            setEditing(false);
            setDraft(null);
            setOpened(null);
        } catch (e: any) {
            setRequisitesError(e.message);
        } finally {
            setSavingRequisites(false);
        }
    };

    const startPersonEdit = async (contact: ContactRow) => {
        setPersonNote(null);
        setPersonEditId(contact.id);
        // ФИО в списке склеено, а правим по полям — берём их с сервера.
        try {
            const res = await fetch(`/api/clients/${clientId}/contacts/${contact.id}`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось открыть данные человека');
            setPersonDraft({
                lastName: payload.person.lastName || '',
                firstName: payload.person.firstName || '',
                patronymic: payload.person.patronymic || '',
                email: payload.person.email || '',
                phones: (payload.person.phones || []).filter(Boolean),
            });
        } catch (e: any) {
            setPersonNote(e.message);
            setPersonEditId(null);
        }
    };

    const savePhones = async () => {
        setPhonesSaving(true);
        setPhonesNote(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/phones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phones }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить');
            setPhones(payload.phones || []);
            setPhonesNote('Сохранено');
        } catch (e: any) {
            setPhonesNote(e.message);
        } finally {
            setPhonesSaving(false);
        }
    };

    const savePerson = async () => {
        if (!personDraft || personEditId === null) return;
        setPersonSaving(true);
        setPersonNote(null);
        try {
            const res = await fetch(`/api/clients/${clientId}/contacts/${personEditId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lastName: personDraft.lastName,
                    firstName: personDraft.firstName,
                    patronymic: personDraft.patronymic,
                    email: personDraft.email,
                    phones: personDraft.phones.map((p) => p.trim()).filter(Boolean),
                }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить');

            const person = payload.person;
            const name = [person.lastName, person.firstName, person.patronymic].filter(Boolean).join(' ').trim();
            setContacts((list) => list.map((row) => (row.id === person.id
                ? { ...row, name: name || null, email: person.email, phones: person.phones }
                : row)));
            setPersonEditId(null);
            setPersonDraft(null);
        } catch (e: any) {
            setPersonNote(e.message);
        } finally {
            setPersonSaving(false);
        }
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/clients/${clientId}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Не удалось открыть карточку клиента');
            setClient(payload.client);
            setRequisites(payload.requisites);
            setRelation(payload.relation || null);
            setRelated(payload.related || []);
            setOrders(payload.orders || []);
            setCalls(payload.calls || []);
            setEmails(payload.emails || []);
            setPhone(payload.phone || null);
            setPhones(Array.isArray(payload.client?.phones) ? payload.client.phones.filter(Boolean) : []);
            setContacts(payload.contacts || []);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => {
        load();
    }, [load]);

    if (loading) {
        return <div className="min-h-screen bg-gray-50 p-4 text-xs text-gray-500">Загружаю…</div>;
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 p-4">
                <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
                <a href="/clients" className="mt-3 inline-block text-xs font-semibold text-gray-500 hover:text-gray-900">← К списку клиентов</a>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex items-baseline gap-3">
                    <h1 className="text-xl font-bold text-gray-900">{client?.company_name || 'Клиент без названия'}</h1>
                    <a href="/clients" className="text-xs font-semibold text-gray-500 hover:text-gray-900">← К списку клиентов</a>
                </div>
                <div className="flex gap-px bg-gray-200 text-xs">
                    <div className="bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">Заказов</div>
                        <div className="font-semibold text-gray-900">{formatIntRu(client?.orders_count || 0)}</div>
                    </div>
                    <div className="bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">Купил на</div>
                        <div className="font-semibold text-gray-900">{formatRub(client?.total_summ || 0)}</div>
                    </div>
                    <div className="bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gray-500">Средний чек</div>
                        <div className="font-semibold text-gray-900">{formatRub(client?.average_check || 0)}</div>
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-gray-200 lg:grid-cols-3">
                <div className="bg-white text-xs">
                    <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        <span>Реквизиты</span>
                        {editing ? (
                            <span className="flex items-center gap-2">
                                <button
                                    onClick={saveRequisites}
                                    disabled={savingRequisites}
                                    className="text-[11px] font-bold normal-case text-blue-700 hover:underline disabled:text-gray-400"
                                >
                                    {savingRequisites ? 'Сохраняем…' : 'Сохранить'}
                                </button>
                                <button
                                    onClick={() => { setEditing(false); setDraft(null); setOpened(null); }}
                                    className="text-[11px] font-bold normal-case text-gray-500 hover:underline"
                                >
                                    Отменить
                                </button>
                            </span>
                        ) : (
                            <button
                                onClick={() => {
                                    setRequisitesError(null);
                                    setDraft({ ...(requisites ?? {}) } as Requisites);
                                    setOpened({ ...(requisites ?? {}) } as Requisites);
                                    setEditing(true);
                                }}
                                className="text-[11px] font-bold normal-case text-blue-700 hover:underline"
                            >
                                Править
                            </button>
                        )}
                    </div>

                    {/* Сбой сохранения — сразу под кнопкой, а не в конце длинной
                        формы: иначе человек не видит ответа и жмёт ещё раз. */}
                    {requisitesError && (
                        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-[11px] text-red-800">
                            {requisitesError}
                        </div>
                    )}

                    {/* Заполнить реквизиты, а не переписывать их руками: по ИНН из
                        реестра или из присланной карточки предприятия (решение
                        владельца 05.10.2026). Заполняются только пустые поля. */}
                    {editing && draft && (
                        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2">
                            <button
                                type="button"
                                onClick={fillByInn}
                                disabled={lookupBusy !== null}
                                className="border border-blue-600 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400"
                            >
                                {lookupBusy === 'inn' ? 'Ищем…' : 'Заполнить по ИНН'}
                            </button>
                            <label className="cursor-pointer border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                                {lookupBusy === 'file' ? 'Читаем файл…' : 'Загрузить карточку предприятия'}
                                <input
                                    type="file"
                                    accept=".pdf,.png,.jpg,.jpeg,.txt"
                                    className="hidden"
                                    disabled={lookupBusy !== null}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void fillFromFile(file);
                                        e.target.value = '';
                                    }}
                                />
                            </label>
                        </div>
                    )}

                    {editing && draft ? (
                        <div className="divide-y divide-gray-100">
                            {([
                                // Два названия: сокращённое для списков и полное
                                // для договоров (просьба Лены 05.10.2026).
                                ['legalName', 'Сокращённое название'],
                                ['fullName', 'Полное наименование'],
                                ['inn', 'ИНН'],
                                ['kpp', 'КПП'],
                                ['ogrn', 'ОГРН'],
                                ['ogrnip', 'ОГРНИП'],
                                // Подписант договора: без него договор не
                                // составить (просьба Лены 05.10.2026).
                                ['signerTitle', 'Должность подписанта'],
                                ['signerName', 'ФИО подписанта'],
                                ['signerBasis', 'Действует на основании'],
                                ['legalAddress', 'Юридический адрес'],
                                ['bank', 'Банк'],
                                ['bankAccount', 'Расчётный счёт'],
                                ['bik', 'БИК'],
                                ['corrAccount', 'Корреспондентский счёт'],
                                ['bankAddress', 'Адрес банка'],
                            ] as Array<[keyof Requisites, string]>).map(([key, label]) => (
                                /* Подпись сверху, поле во всю ширину: подпись сбоку
                                   съедала 160px узкой колонки, и расчётный счёт с
                                   юридическим адресом обрезались на середине —
                                   проверить введённое было нельзя (замечание
                                   владельца 05.10.2026). Так же, как в режиме
                                   просмотра. */
                                <label key={String(key)} className="block px-4 py-1.5">
                                    <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
                                    {key === 'legalAddress' || key === 'bankAddress' || key === 'legalName' || key === 'fullName' || key === 'bank' ? (
                                        /* Адреса, название и банк в одну строку не влезают
                                           никогда — показываем их целиком в несколько строк. */
                                        <AutoTextarea
                                            value={String(draft[key] ?? '')}
                                            onChange={(next) => setDraft({ ...draft, [key]: next })}
                                        />
                                    ) : (
                                        <input
                                            value={String(draft[key] ?? '')}
                                            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                                            title={String(draft[key] ?? '')}
                                            className="w-full border border-gray-300 px-2 py-1"
                                        />
                                    )}
                                </label>
                            ))}
                        </div>
                    ) : (
                        <>
                            <Field label="Сокращённое название" value={requisites?.legalName} />
                            <Field label="Полное наименование" value={requisites?.fullName} />
                            <Field label="ИНН" value={requisites?.inn} />
                            <Field label="КПП" value={requisites?.kpp} />
                            <Field label="ОГРН / ОГРНИП" value={requisites?.ogrn || requisites?.ogrnip} />
                            <Field label="Подписант договора" value={[requisites?.signerTitle, requisites?.signerName].filter(Boolean).join(', ')} />
                            <Field label="Действует на основании" value={requisites?.signerBasis} />
                            <Field label="Юридический адрес" value={requisites?.legalAddress} />
                            <Field label="Банк" value={requisites?.bank} />
                            <Field label="Расчётный счёт" value={requisites?.bankAccount} />
                            <Field label="БИК" value={requisites?.bik} />
                            <Field label="Корреспондентский счёт" value={requisites?.corrAccount} />
                        </>
                    )}

                    {requisitesNote && (
                        <div className="px-4 py-2 text-[11px] text-amber-800">{requisitesNote}</div>
                    )}
                    {!editing && requisites?.source === 'order' && requisites?.fromOrderNumber && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Показаны из заказа №{requisites.fromOrderNumber} — в карточке их ещё нет.
                            Нажмите «Править» и сохраните: дальше они будут подтягиваться в каждый новый заказ.
                        </div>
                    )}
                    {/* Реквизиты взяты из заказа, а юрлицо в них другое: в карточке
                        «ООО Ресурс Комплект Сервис» показывалась «Росхимзащита», и
                        понять это было нельзя (замечание владельца 05.10.2026).
                        Молчать тут опаснее всего — по этим реквизитам выставляют
                        счёт. */}
                    {!editing
                        && requisites?.source === 'order'
                        && requisites?.legalName
                        && client?.company_name
                        && !sameCompany(requisites.legalName, client.company_name) && (
                        <div className="border border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-relaxed text-amber-900">
                            Реквизиты показаны из заказа №{requisites.fromOrderNumber ?? '—'}, и юрлицо в них
                            другое: <b>{requisites.legalName}</b>. Проверьте, тот ли это заказчик, и внесите
                            реквизиты в карточку.
                        </div>
                    )}

                    {!editing && requisites?.source === 'client' && requisites?.updatedAt && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Обновлены {new Date(requisites.updatedAt).toLocaleDateString('ru-RU')}
                            {requisites.updatedBy ? ` · ${requisites.updatedBy}` : ''}
                        </div>
                    )}

                    {/* Файлы компании и признак «наше юрлицо» — здесь же, в
                        карточке: отдельный раздел владельцу не нужен
                        (решение 08.10.2026). */}
                    <ClientFiles clientId={String(clientId)} />

                    {/* Телефоны компании: их несколько, и менеджер добавляет
                        столько, сколько нужно (просьба 08.10.2026). Номер в
                        карточке — это ещё и будущая кнопка «позвонить» из
                        реестра звонков: звоним только по тому, что здесь. */}
                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Телефоны компании
                    </div>
                    <div className="space-y-1.5 px-4 py-3">
                        {phones.length === 0 && (
                            <div className="text-gray-500">Телефонов не записано.</div>
                        )}
                        {phones.map((value, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <input
                                    value={value}
                                    onChange={(e) => setPhones(phones.map((p, i) => (i === index ? e.target.value : p)))}
                                    placeholder="+7 (999) 000-00-00"
                                    className="w-full max-w-xs border border-gray-300 px-2 py-1"
                                />
                                <a
                                    href={`tel:${value.replace(/[^\d+]/g, '')}`}
                                    className="text-[11px] font-bold text-blue-700 hover:underline"
                                >
                                    позвонить
                                </a>
                                <button
                                    onClick={() => setPhones(phones.filter((_, i) => i !== index))}
                                    className="text-[11px] font-bold text-gray-500 hover:underline"
                                >
                                    убрать
                                </button>
                            </div>
                        ))}
                        <div className="flex items-center gap-3 pt-1">
                            <button
                                onClick={() => setPhones([...phones, ''])}
                                className="text-[11px] font-bold text-blue-700 hover:underline"
                            >
                                Добавить телефон
                            </button>
                            <button
                                onClick={savePhones}
                                disabled={phonesSaving}
                                className="text-[11px] font-bold text-blue-700 hover:underline disabled:text-gray-400"
                            >
                                {phonesSaving ? 'Сохраняем…' : 'Сохранить'}
                            </button>
                            {phonesNote && <span className="text-[11px] text-gray-500">{phonesNote}</span>}
                        </div>
                        {phone && !phones.length && (
                            <div className="text-[11px] text-gray-500">Из последнего заказа: {phone}</div>
                        )}
                    </div>

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Контактные лица
                    </div>
                    {contacts.length === 0 && (
                        <>
                            <div className="px-4 py-3 text-gray-500">Контактных лиц не нашли — показываем связь из заказа.</div>
                            <Field label="Телефон" value={phone} />
                            <Field label="Почта" value={client?.email || client?.contact_email} />
                        </>
                    )}
                    {personNote && (
                        <div className="px-4 py-2 text-[11px] text-amber-800">{personNote}</div>
                    )}
                    {contacts.map((person) => (
                        <div key={person.id} className="border-b border-gray-100 px-4 py-3">
                            {personEditId === person.id && personDraft ? (
                                <div className="space-y-1.5">
                                    {([
                                        ['lastName', 'Фамилия'],
                                        ['firstName', 'Имя'],
                                        ['patronymic', 'Отчество'],
                                        ['email', 'Почта'],
                                    ] as Array<['lastName' | 'firstName' | 'patronymic' | 'email', string]>).map(([key, label]) => (
                                        <label key={key} className="flex items-center gap-2">
                                            <span className="w-24 shrink-0 text-gray-500">{label}</span>
                                            <input
                                                value={personDraft[key]}
                                                onChange={(e) => setPersonDraft({ ...personDraft, [key]: e.target.value })}
                                                className="w-full border border-gray-300 px-2 py-1"
                                            />
                                        </label>
                                    ))}

                                    {/* Телефонов столько, сколько нужно: у человека
                                        бывает рабочий, мобильный и приёмная. */}
                                    {(personDraft.phones.length ? personDraft.phones : ['']).map((value, index) => (
                                        <label key={index} className="flex items-center gap-2">
                                            <span className="w-24 shrink-0 text-gray-500">
                                                {index === 0 ? 'Телефон' : 'Ещё телефон'}
                                            </span>
                                            <input
                                                value={value}
                                                onChange={(e) => {
                                                    const next = personDraft.phones.length ? [...personDraft.phones] : [''];
                                                    next[index] = e.target.value;
                                                    setPersonDraft({ ...personDraft, phones: next });
                                                }}
                                                className="w-full border border-gray-300 px-2 py-1"
                                            />
                                            {personDraft.phones.length > 1 && (
                                                <button
                                                    onClick={() => setPersonDraft({
                                                        ...personDraft,
                                                        phones: personDraft.phones.filter((_, i) => i !== index),
                                                    })}
                                                    className="shrink-0 text-[11px] font-bold text-gray-500 hover:underline"
                                                >
                                                    убрать
                                                </button>
                                            )}
                                        </label>
                                    ))}
                                    <button
                                        onClick={() => setPersonDraft({
                                            ...personDraft,
                                            phones: [...(personDraft.phones.length ? personDraft.phones : ['']), ''],
                                        })}
                                        className="text-[11px] font-bold text-blue-700 hover:underline"
                                    >
                                        Добавить телефон
                                    </button>
                                    <div className="flex items-center gap-3 pt-1">
                                        <button
                                            onClick={savePerson}
                                            disabled={personSaving}
                                            className="text-[11px] font-bold text-blue-700 hover:underline disabled:text-gray-400"
                                        >
                                            {personSaving ? 'Сохраняем…' : 'Сохранить'}
                                        </button>
                                        <button
                                            onClick={() => { setPersonEditId(null); setPersonDraft(null); }}
                                            className="text-[11px] font-bold text-gray-500 hover:underline"
                                        >
                                            Отменить
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <div className="font-semibold text-gray-900">{person.name || 'Без имени'}</div>
                                        <button
                                            onClick={() => startPersonEdit(person)}
                                            className="text-[11px] font-bold text-blue-700 hover:underline"
                                        >
                                            Править
                                        </button>
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                        {person.phones.length ? person.phones.join(' · ') : 'телефон неизвестен'}
                                        {person.email ? ` · ${person.email}` : ''}
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                        заказов с ним: {formatIntRu(person.ordersCount)}
                                        {person.lastOrderAt ? ` · последний ${new Date(person.lastOrderAt).toLocaleDateString('ru-RU')}` : ''}
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                <div className="bg-white text-xs">
                    <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        О компании
                    </div>
                    {!relation && (
                        <div className="px-4 py-3 text-gray-500">
                            {requisites?.inn
                                ? `Данные из ЕГРЮЛ по ИНН ${requisites.inn} ещё не собирали — они подтягиваются по клиентам отдела продаж.`
                                : 'Данных о компании нет: они подтягиваются по ИНН, а он у клиента неизвестен.'}
                        </div>
                    )}
                    {relation && (
                        <>
                            <Field label="Чем занимается" value={relation.activity} />
                            <Field label="Регион" value={relation.region} />
                            <Field label="Состояние" value={relation.company_status} />
                            <Field label="Филиалов" value={relation.branches ? formatIntRu(relation.branches) : null} />
                            <Field
                                label="Роль в сделке"
                                value={isReseller(relation.okved_code)
                                    ? 'Скорее посредник — основной вид деятельности торговля'
                                    : 'Скорее конечный заказчик'}
                            />
                            <Field label="Следующий контакт" value={relation.next_contact_at ? new Date(relation.next_contact_at).toLocaleDateString('ru-RU') : null} />
                        </>
                    )}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Карточки того же юрлица
                    </div>
                    {related.length === 0 && (
                        <div className="px-4 py-3 text-gray-500">Других карточек не нашли.</div>
                    )}
                    {related.map((item) => (
                        <button
                            key={item.customerId}
                            onClick={() => router.push(`/clients/${item.customerId}`)}
                            className="block w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-amber-50"
                        >
                            <div className="font-semibold text-gray-900">{item.name || 'Без названия'}</div>
                            <div className="text-[11px] text-gray-500">
                                {formatIntRu(item.ordersCount || 0)} заказов на {formatRub(item.totalSumm || 0)} · связь по: {item.reason}
                            </div>
                        </button>
                    ))}
                    {related.length > 0 && (
                        <div className="px-4 py-2 text-[11px] text-gray-500">
                            Карточки не объединяются автоматически — решение за менеджером.
                        </div>
                    )}

                    {/* Группа компаний: разные юрлица одного покупателя считаются
                        одним клиентом (решение владельца 06.10.2026). Стоит сразу
                        под найденными карточками — там и видно, что объединять. */}
                    <CompanyGroupPanel
                        clientId={clientId}
                        clientName={client?.company_name || ''}
                        onChanged={() => void load()}
                    />
                </div>

                <div className="bg-white text-xs lg:col-span-1">
                    <div className="border-b border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Заказы
                    </div>
                    {orders.length === 0 && <div className="px-4 py-3 text-gray-500">Заказов нет.</div>}
                    {orders.map((order) => (
                        <div key={order.orderId} className="border-b border-gray-100 px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="font-semibold text-gray-900">
                                    №<OrderNumberLink number={order.number} />
                                </span>
                                <span className="text-gray-900">{order.total ? formatRub(order.total) : <Dash />}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {order.statusName || <Dash />}
                                {order.createdAt ? ` · ${new Date(order.createdAt).toLocaleDateString('ru-RU')}` : ''}
                                {order.managerName ? ` · ${order.managerName}` : ''}
                            </div>
                        </div>
                    ))}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Звонки
                    </div>
                    {calls.length === 0 && (
                        <div className="px-4 py-3 text-gray-500">
                            Звонков не нашли. Они связываются с клиентом через номера его заказов — звонок без номера заказа сюда не попадёт.
                        </div>
                    )}
                    {calls.map((call, index) => (
                        <div key={`${call.at}-${index}`} className="border-b border-gray-100 px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-gray-900">
                                    {call.direction}
                                    {call.missed && <span className="ml-2 text-red-600">пропущен</span>}
                                </span>
                                <span className="text-gray-500">{formatDuration(call.durationSec)}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {new Date(call.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {call.managerName ? ` · ${call.managerName}` : ''}
                                {call.orderNumber ? <> · заказ №<OrderNumberLink number={call.orderNumber} /></> : ''}
                                {call.hasRecording ? ' · есть запись' : ''}
                            </div>
                        </div>
                    ))}

                    <div className="border-y border-gray-200 bg-gray-100 px-4 py-2 font-bold uppercase tracking-wide text-gray-700">
                        Письма
                    </div>
                    {emails.length === 0 && <div className="px-4 py-3 text-gray-500">Писем от этого адреса нет.</div>}
                    {emails.map((mail, index) => (
                        <div key={`${mail.at}-${index}`} className="border-b border-gray-100 px-4 py-3">
                            <div className="text-gray-900">{mail.subject || 'Без темы'}</div>
                            <div className="text-[11px] text-gray-500">
                                {new Date(mail.at).toLocaleDateString('ru-RU')} · {mail.outcome}
                                {mail.orderNumber ? <> · заказ №<OrderNumberLink number={mail.orderNumber} /></> : ''}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
