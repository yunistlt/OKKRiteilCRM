'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { checkCounterpartyByInn, CounterpartyScoreResult } from '@/lib/legal-counterparty-check';
import CallInitiator from './calls/CallInitiator';
import PhoneFieldCall from './calls/PhoneFieldCall';
import ManagerTransfer from './orders/ManagerTransfer';
import TextWithOrderLinks from './ui/TextWithOrderLinks';
import { CardSection, CardSectionsProvider } from './orders/CardSections';
import ItemPhoto from './orders/ItemPhoto';
import AttachmentList from './orders/AttachmentList';
import { prependComment } from '@/lib/own-crm/comment-entries';
import { clientTime } from '@/lib/own-crm/phone-timezone';
import { useAuth } from '@/components/auth/AuthProvider';
import { STANDARD_CONTRACT_TERMS } from '@/lib/legal/contract-terms';
import { priceSourceLabel } from '@/lib/format';
import { itemTotalWithDiscount, orderTotals } from '@/lib/own-crm/discount';
import { uniquePhones } from '@/lib/own-crm/phones';
import { useBreadcrumbs } from '@/components/ui/BreadcrumbsContext';
import { siteSearchUrl } from '@/lib/own-crm/site-link';
import { isVisibleBreakdownKey } from '@/lib/okk-consultant';
import { useStatusNames } from '@/components/useStatusNames';
import { useDictionaryNames } from '@/components/useDictionaryNames';
import { formatQualityCriterionLabel } from '@/lib/quality-labels';
import OrderReplyForm from '@/components/orders/OrderReplyForm';
import { NumberInput } from '@/components/ui/NumberInput';
import OrderSidePanel, { PanelKind } from '@/components/orders/OrderSidePanel';
import { itemNameWithVariant } from '@/lib/own-crm/item-name';
import OrderStatusSwitcher from '@/components/orders/OrderStatusSwitcher';
import OwnOrderPayments from '@/components/own-crm/OwnOrderPayments';
import { decodeEntities } from '@/lib/sales-rop/letter-render';

interface OrderDetailsModalProps {
    orderId: number;
    isOpen: boolean;
    onClose: () => void;
    /** Переход из списка писем: ответить этому адресату на это письмо. */
    replyTo?: string | null;
    replySubject?: string | null;
}

interface OrderDetails {
    /** Цвет статуса — им подкрашивается карточка. Назначен людьми в настройках. */
    statusColor?: string | null;
    statusName?: string | null;
    statusGroup?: string | null;
    order: any;
    calls: any[];
    emails: any[];
    /** Советы бота-РОПа — своим окном, а не в комментарии менеджера. */
    ropNotes?: Array<{ date: string | null; text: string }>;
    /** Название компании заказчика из его карточки — в заказе его может не быть. */
    clientCompanyName?: string | null;
    /** Карточка клиента для ссылок: заказчик-юрлицо либо компания его контактного лица. */
    clientCardId?: number | null;
    history: any[];
    /** Названия и цвета статусов — для плашек в истории. */
    statusPalette?: Record<string, { name: string; color: string | null }>;
    priority?: any;
    insights?: any;
    raw_payload: any;
}

interface InfoFieldProps {
    label: string;
    value?: ReactNode;
    required?: boolean;
}

const viewTabs = [
    { id: 'card', label: 'Карточка заказа' },
    { id: 'quality', label: 'Качество заявки' },
    // Поля, которые менеджеру в работе не нужны, живут отдельно: на основном
    // экране должно быть максимум данных по заказу и ничего лишнего
    // (требование владельца 02.10.2026).
    { id: 'tech', label: 'Технические данные' },
    /**
     * Для производства: что менеджер осознанно передаёт в цех.
     *
     * Комментарий менеджера туда больше не уезжает — в нём договорённости по
     * цене и заметки про конкурентов, цеху это не нужно (решение владельца
     * 04.10.2026). Вместо него менеджер пишет отдельный текст и отмечает файлы.
     */
    { id: 'production', label: 'Для производства' }
] as const;

const sectionNavItems = [
    { id: 'order-common', label: 'Основное' },
    { id: 'order-customer', label: 'Клиент' },
    // Доп. данные идут сразу за клиентом: менеджер смотрит их в начале работы
    // с заказом, а не в самом низу карточки.
    { id: 'order-custom-fields', label: 'Доп. данные' },
    { id: 'order-list', label: 'Состав заказа' },
    { id: 'order-delivery', label: 'Отгрузка и доставка' },
    { id: 'order-payment', label: 'Оплата' }
] as const;

type ViewTab = typeof viewTabs[number]['id'];
type QualityMobileTab = 'calls' | 'transcript' | 'analysis';
type ScoreBreakdownEntry = {
    result?: boolean | null;
    reason?: string | null;
    reason_human?: string | null;
    rule_id?: string | null;
    source_refs?: string[];
    source_values?: Record<string, any> | null;
    calculation_steps?: string[];
    confidence?: number | null;
    missing_data?: string[];
    recommended_fix?: string | null;
};

/**
 * Поле карточки, которое можно править. Режима «только просмотр» у нас нет:
 * открыл карточку — можешь менять. Поля без обработчика остаются показом
 * (например, вычисленные значения вроде «обновлён»).
 */
/**
 * Ошибки правки по полям: какое поле подсветить и что в нём не так.
 * Через контекст, чтобы не тащить их пропом через всю карточку
 * (просьба Жени 05.10.2026 — «не подсвечивается вообще»).
 */
const FieldErrorsContext = createContext<Record<string, string>>({});

/**
 * Поля, изменённые и ещё не сохранённые. Внизу карточки давно висело «Есть
 * несохранённые изменения», но какие именно — было не видно (Ирина Гордеева
 * 05.10.2026: «а как увидеть где?»).
 */
const FieldDirtyContext = createContext<Set<string>>(new Set());

const EditField = ({ label, value, onChange, required, type = 'text', options, action, fieldKey, multiline }: {
    label: string;
    value: any;
    onChange?: (value: any) => void;
    required?: boolean;
    type?: 'text' | 'number' | 'date';
    options?: Array<{ value: string; label: string }>;
    /** Кнопка рядом с полем — например «Звонок» у телефона. */
    action?: ReactNode;
    /** Ключ черновика — по нему поле узнаёт свою ошибку. */
    fieldKey?: string;
    /**
     * Поле в несколько строк — для тех, куда пишут длинный текст (требование
     * владельца 06.10.2026 про комментарий логисту: «туда пишут длинные
     * портянки, так же как в комментарий оператору»).
     */
    multiline?: boolean;
}) => {
    const problem = useContext(FieldErrorsContext)[fieldKey ?? ''];
    const changed = useContext(FieldDirtyContext).has(fieldKey ?? '');
    const frame = problem
        ? 'border-red-500 bg-red-50'
        : changed
            ? 'border-amber-500 bg-amber-50'
            : 'border-gray-300 bg-white';

    return (
    <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            {label}
            {required && <span className="text-red-500">*</span>}
        </div>
        {onChange && options ? (
            <select
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                className={`w-full px-2 py-1 border text-sm text-gray-900 ${frame}`}
            >
                <option value="">Не выбрано</option>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        ) : onChange && multiline ? (
            <textarea
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                rows={4}
                className={`w-full resize-y px-2 py-1 border text-sm text-gray-900 ${frame}`}
            />
        ) : onChange ? (
            <div className="flex items-stretch gap-1">
                <input
                    type={type}
                    value={value ?? ''}
                    onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
                    // Календарь открывается щелчком по всему полю, а не только по
                    // маленькому значку справа (просьба владельца 05.10.2026).
                    // Руками дату по-прежнему можно напечатать: поле остаётся
                    // обычным полем ввода.
                    onClick={(e) => {
                        if (type !== 'date') return;
                        const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                        try { el.showPicker?.(); } catch { /* старый браузер — останется значок */ }
                    }}
                    className={`w-full px-2 py-1 border text-sm text-gray-900 ${frame} ${type === 'date' ? 'cursor-pointer' : ''}`}
                />
                {action}
            </div>
        ) : (
            <div className="px-2 py-1 border text-sm bg-gray-50 border-gray-200 text-gray-900">
                {value ?? <span className="text-gray-400">Не указано</span>}
            </div>
        )}
        {problem
            ? <div className="text-xs text-red-600">{problem}</div>
            : changed ? <div className="text-xs text-amber-700">Не сохранено</div> : null}
    </div>
    );
};

const InfoField = ({ label, value, required }: InfoFieldProps) => (
    <div className="space-y-0.5">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            {label}
            {required && <span className="text-red-500">*</span>}
        </div>
        <div className="px-2 py-1 border text-sm bg-gray-50 border-gray-200 text-gray-900">
            {value ?? <span className="text-gray-400">Не указано</span>}
        </div>
    </div>
);

/**
 * Очень слабый оттенок цвета статуса: цвет подмешивается к белому, а НЕ
 * задаётся прозрачностью. Прозрачный фон просвечивает насквозь — карточка
 * тогда показывает список заказов под собой (поймано 30.09.2026).
 */
/**
 * Тон карточки по цвету статуса — «очень нежный, еле заметный» (требование
 * владельца 30.09.2026). Цвета статусов теперь берутся от этапа и они насыщенные
 * (оранжевый «Новый», красный «Тендер»), поэтому примеси нужно совсем немного.
 */
const tintFromColor = (color?: string | null, strength = 0.07): string | undefined => {
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
        return undefined;
    }
    const mix = (channel: number) => Math.round(255 - (255 - channel) * strength);
    const r = mix(parseInt(color.slice(1, 3), 16));
    const g = mix(parseInt(color.slice(3, 5), 16));
    const b = mix(parseInt(color.slice(5, 7), 16));
    return `rgb(${r}, ${g}, ${b})`;
};

const pickValue = (...values: any[]) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        return value;
    }
    return null;
};

const formatCountryName = (iso?: string | null) => {
    if (!iso) return 'Россия';
    const upper = iso.toUpperCase();
    const dictionary: Record<string, string> = {
        RU: 'Россия',
        KZ: 'Казахстан',
        BY: 'Беларусь',
        UA: 'Украина'
    };
    return dictionary[upper] || upper;
};

const formatBooleanYesNo = (value?: boolean | null) => (value ? 'Да' : 'Нет');

const extractItemPrice = (item: any) => {
    const price = pickValue(item?.prices?.[0]?.price, item?.initialPrice, item?.price);
    if (price === null) return 0;
    return typeof price === 'number' ? price : Number(price) || 0;
};

const extractItemQuantity = (item: any) => {
    const quantity = pickValue(item?.prices?.[0]?.quantity, item?.quantity, item?.qty, 1);
    if (quantity === null) return 1;
    return typeof quantity === 'number' ? quantity : Number(quantity) || 1;
};

const toNumber = (value: any) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const parsed = Number((value as string).toString().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
};

const toArray = (value: any) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
};

export default function OrderDetailsModal({ orderId, isOpen, onClose, replyTo, replySubject }: OrderDetailsModalProps) {

    const statusName = useStatusNames();
    const names = useDictionaryNames();
    // Звоним от имени того, кто сидит в карточке: Телфин набирает его добавочный.
    const { user } = useAuth();
    const callManagerId = user?.retail_crm_manager_id ? String(user.retail_crm_manager_id) : null;
    /** Кем подписывать запись в комментарии: фамилия и имя, иначе логин. */
    const commentAuthor = [user?.last_name, user?.first_name].filter(Boolean).join(' ')
        || user?.username
        || null;
    const [data, setData] = useState<OrderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [replyOpen, setReplyOpen] = useState(false);
    // Шапка ужимается при прокрутке, как в RetailCRM: развёрнутая съедала треть
    // экрана, а менеджеру при работе с полями нужны только номер, сумма и дата.
    const [compactHeader, setCompactHeader] = useState(false);
    const [printOpen, setPrintOpen] = useState(false);
    // Договор по заказу: окно с условиями, которые менеджер пишет словами.
    const [contractOpen, setContractOpen] = useState(false);
    const [contractTerms, setContractTerms] = useState('');
    /** Выбранный стандартный шаблон условий. Пусто — менеджер пишет свои. */
    const [contractTermCode, setContractTermCode] = useState('');
    /** Замечания ИИ-юрисконсульта к составленному договору. */
    const [contractReview, setContractReview] = useState<{
        level: 'ok' | 'attention' | 'risk';
        summary: string;
        notes: string[];
        byAi: boolean;
    } | null>(null);
    const [contractSaving, setContractSaving] = useState(false);
    const [contractNote, setContractNote] = useState<string | null>(null);
    // Номер созданного договора — по нему даём ссылку на сам файл.
    const [contractId, setContractId] = useState<number | null>(null);
    /**
     * Какой документ сейчас собирается.
     *
     * Договор и комплект «счёт + договор + спецификация» собираются из заказа
     * на лету — это несколько секунд. Обычная ссылка на такое молчит: Лена
     * Парфёнова 09.10.2026 «тут не открывает, в файлах нет». Теперь кнопка
     * честно говорит, что идёт сборка, и сама открывает готовый файл.
     */
    const [documentBusy, setDocumentBusy] = useState<'contract' | 'kit' | null>(null);
    const [documentNote, setDocumentNote] = useState<string | null>(null);
    // Карточка заказа редактируемая сразу: режима «только просмотр» у нас нет.
    // Правка копится в состоянии и уходит в CRM одной кнопкой сверху.
    // Разовая скидка на заказ — рублями и процентом, как в RetailCRM.
    const [draftOrderDiscount, setDraftOrderDiscount] = useState({ amount: 0, percent: 0 });
    // discount — скидка на ЕДИНИЦУ товара, как её считает RetailCRM
    // (item.discountTotal): цена со скидкой = price − discount.
    const [draftItems, setDraftItems] = useState<Array<{ id?: number | null; name: string; quantity: number; price: number; discount: number; discountPercent: number; article?: string | null; siteId?: string | null; xmlId?: string | null }>>([]);
    // Ссылки на карточки товаров сайта по артикулу: название в составе кликабельно.
    const [catalogLinks, setCatalogLinks] = useState<Record<string, { url: string; name: string; image?: string | null }>>({});
    const [draftClientComment, setDraftClientComment] = useState('');
    const [draftManagerComment, setDraftManagerComment] = useState('');
    const [dirty, setDirty] = useState(false);
    const [savingOrder, setSavingOrder] = useState(false);
    const [saveNote, setSaveNote] = useState<string | null>(null);
    /** На какое письмо отвечаем: адрес, тема и цитата для формы ответа. */
    const [replySource, setReplySource] = useState<{ to: string | null; subject: string | null; quote: string | null } | null>(null);
    /** Новая запись в комментарий: метку ставит система при добавлении. */
    const [newComment, setNewComment] = useState('');
    /** Время тикает: пересчитываем раз в минуту, иначе «у клиента» застывает. */
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(timer);
    }, []);

    /**
     * Подпись поля телефона с местным временем клиента: «Основной телефон ·
     * 19:00 у клиента (+7 ч к Москве)». По мобильному время не показываем — он
     * переносится между регионами и соврал бы.
     */
    const phoneLabel = (label: string, phone: string) => {
        const local = clientTime(phone, now);
        if (!local) return label;
        return `${label} · ${local.time} у клиента${local.shift ? ` (${local.shift})` : ''}`;
    };

    /** Разбор адреса доставки по частям: идёт ли сейчас и что сказать человеку. */
    const [parsingAddress, setParsingAddress] = useState(false);
    const [addressNote, setAddressNote] = useState<string | null>(null);

    /**
     * Пришли из списка писем — открываем ответ. Само письмо ищем в переписке
     * заказа по адресу и теме: так находится и цитата, а если письма здесь нет
     * (переписка ещё не подтянулась), отвечаем без неё.
     */
    useEffect(() => {
        if (!replyTo && !replySubject) return;
        if (!data) return;

        const mail = (data.emails ?? []).find((e: any) =>
            (!replySubject || String(e.subject ?? '') === replySubject)
            && (!replyTo || String(e.partyEmail ?? '') === replyTo));

        setReplySource({
            to: replyTo || mail?.partyEmail || null,
            subject: replySubject || mail?.subject || null,
            quote: mail?.body ? String(mail.body).slice(0, 4000) : null,
        });
        setReplyOpen(true);
    }, [replyTo, replySubject, data]);
    /** Поля с ошибками: ключ черновика → что не так. Подсвечиваются красным. */
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    // Правка остальных полей карточки. Ключи: имя поля заказа (firstName, phone…),
    // «cf.<код>» для своих полей RetailCRM и «delivery.<поле>» для доставки.
    const [draftFields, setDraftFields] = useState<Record<string, any>>({});
    /** Ключи изменённых полей — ими карточка подсвечивает, что не сохранено. */
    const dirtyKeys = new Set(Object.keys(draftFields));
    // От какого нашего юрлица выставляем счёт. Пусто — от юрлица магазина заказа.
    const [sellerCode, setSellerCode] = useState('');
    const [sellerOptions, setSellerOptions] = useState<Array<{ code: string; name: string }>>([]);
    /**
     * Карточка занимает ровно рабочую область — без меню слева и чата справа.
     * Позицию берём у контейнера страницы: «absolute inset-0» внутри него
     * растягивало карточку на всю длину списка, а «fixed inset-0» закрывало
     * меню и чат (поймано 30.09.2026).
     */
    const [frame, setFrame] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

    useEffect(() => {
        const area = document.querySelector('[data-ui-audit="page-scroller"]');
        if (!area) {
            setFrame(null);
            return;
        }

        const measure = () => {
            const box = area.getBoundingClientRect();
            setFrame((prev) =>
                prev && prev.top === box.top && prev.left === box.left && prev.width === box.width && prev.height === box.height
                    ? prev
                    : { top: box.top, left: box.left, width: box.width, height: box.height },
            );
        };

        measure();
        // Замер один раз не годится: рабочая область съезжает, когда человек
        // сворачивает меню слева или тянет колонку плана справа, и карточка
        // оставалась на старом месте — поверх списка, со сдвигом (01.10.2026).
        const observer = new ResizeObserver(measure);
        observer.observe(area);
        observer.observe(document.body);
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, []);
    const [catalogQuery, setCatalogQuery] = useState('');
    const [catalogFound, setCatalogFound] = useState<Array<{
        id: string;
        article?: string | null;
        name: string;
        price: number;
        priceLive: boolean;
        priceSource?: 'live' | 'cache' | 'none';
        /** Размеры одного товара: «на 24 пары», «на 30 пар» — у каждого своя цена. */
        variants?: Array<{ id: string; name: string; article: string | null; price: number }>;
    }>>([]);
    /** У какого найденного товара раскрыт список размеров. */
    const [openVariants, setOpenVariants] = useState<string | null>(null);
    /**
     * Расчёты из калькулятора «Бот-Инженер» по этому заказу: менеджер считает
     * там изделие и вписывает номер нашего заказа, мы находим расчёт по номеру.
     */
    const [calcItems, setCalcItems] = useState<Array<{ type: string; id: string; title: string; price: number; quantity: number; weightKg: number | null; author: string | null; createdAt: string | null; params: string; inOrder: boolean }>>([]);
    const [calcNote, setCalcNote] = useState<string | null>(null);
    const [calcTaking, setCalcTaking] = useState<string | null>(null);
    // Что ответил каталог: «не подключён», «не ответил», «цены из витрины».
    // Молчать нельзя — пустой список человек читает как «товара нет».
    const [catalogNote, setCatalogNote] = useState<string | null>(null);
    const catalogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [printTemplates, setPrintTemplates] = useState<Array<{ id: string; code: string; name: string }>>([]);
    const [panel, setPanel] = useState<PanelKind | null>(null);
    /** Сколько писем клиента менеджер ещё не читал — цифра на кнопке «Переписка». */
    const [mailUnread, setMailUnread] = useState(0);
    const [taskCount, setTaskCount] = useState<{ done: number; total: number } | null>(null);
    const [counterpartyScore, setCounterpartyScore] = useState<CounterpartyScoreResult | null>(null);
    const [counterpartyScoreLoading, setCounterpartyScoreLoading] = useState(false);
    const [viewTab, setViewTab] = useState<ViewTab>('card');
    // Вкладка «Для производства»: свой комментарий и отметки файлов для цеха.
    const [productionNote, setProductionNote] = useState('');
    const [productionFiles, setProductionFiles] = useState<number[]>([]);
    const [productionSaving, setProductionSaving] = useState(false);
    /** Файл с компьютера прямо во вкладке производства. */
    const [productionUploading, setProductionUploading] = useState(false);
    const [productionMessage, setProductionMessage] = useState<string | null>(null);
    const [productionData, setProductionData] = useState<{
        comment: string;
        updatedBy: string | null;
        updatedAt: string | null;
        files: Array<{ id: number; fileName: string; contentType: string | null; sizeBytes: number | null; forProduction: boolean }>;
    } | null>(null);
    const [qualityCalls, setQualityCalls] = useState<any[]>([]);
    const [qualityScore, setQualityScore] = useState<any | null>(null);
    const [qualityCallsLoading, setQualityCallsLoading] = useState(false);
    const [qualityScoreLoading, setQualityScoreLoading] = useState(false);
    const [qualityError, setQualityError] = useState<string | null>(null);
    const [selectedCallIndex, setSelectedCallIndex] = useState(0);
    const [qualityMobileTab, setQualityMobileTab] = useState<QualityMobileTab>('calls');
    const [transcribing, setTranscribing] = useState(false);
    const [qualityFetched, setQualityFetched] = useState(false);

    /**
     * Открыть документ заказа, который собирается на лету.
     *
     * Договор и комплект строятся из самого заказа — это несколько секунд.
     * Пока идёт сборка, кнопка говорит об этом; готовый файл открываем в
     * новой вкладке, а если браузер её заблокировал — отдаём файлом. Ошибку
     * показываем словами сервера, а не молчим.
     */
    const openOrderDocument = useCallback(async (kind: 'contract' | 'kit', url: string) => {
        setDocumentBusy(kind);
        setDocumentNote(null);
        try {
            const res = await fetch(url);
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.error || 'Документ не собрался');
            }

            const blob = await res.blob();
            const href = URL.createObjectURL(blob);
            const opened = window.open(href, '_blank');
            if (!opened) {
                // Всплывающее окно заблокировано — тогда просто скачиваем.
                const link = document.createElement('a');
                link.href = href;
                link.download = kind === 'kit' ? 'Счёт, договор и спецификация.pdf' : 'Договор.pdf';
                link.click();
            }
            // Ссылку держим минуту: вкладка успевает прочитать файл.
            setTimeout(() => URL.revokeObjectURL(href), 60_000);
            setDocumentNote(kind === 'kit'
                ? 'Комплект готов и лежит во вкладке «Файлы» этого заказа.'
                : 'Договор открыт. Он же лежит во вкладке «Файлы».');
        } catch (e: any) {
            setDocumentNote(e?.message ?? 'Документ не открылся');
        } finally {
            setDocumentBusy(null);
        }
    }, []);

    const fetchQualityScore = useCallback(async () => {
        if (!orderId) return;
        setQualityScoreLoading(true);
        try {
            const res = await fetch(`/api/okk/scores/${orderId}`);
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error || 'Не удалось загрузить оценку');
            }
            setQualityScore(json.order || json.score || null);
        } catch (e: any) {
            console.error(e);
            setQualityError(e.message || 'Не удалось загрузить качество');
        } finally {
            setQualityScoreLoading(false);
        }
    }, [orderId]);

    useEffect(() => {
        const number = data?.order?.number ?? orderId;
        if (!number) return;
        fetch(`/api/orders/${number}/tasks`)
            .then((r) => r.json())
            .then((d) => setTaskCount({ done: d.done ?? 0, total: d.total ?? 0 }))
            .catch(() => setTaskCount(null));
    }, [data?.order?.number, orderId]);

    // Расчёты калькулятора тянем один раз на открытие карточки: их немного, и
    // менеджеру нужно видеть их сразу, а не нажимать «обновить».
    const loadCalculations = useCallback(async () => {
        if (!orderId) return;
        try {
            const res = await fetch(`/api/orders/${orderId}/calculations`);
            const payload = await res.json();
            setCalcItems(payload.items || []);
            setCalcNote(payload.available === false ? payload.reason : null);
        } catch {
            setCalcItems([]);
            setCalcNote('Не удалось спросить калькулятор о расчётах по этому заказу');
        }
    }, [orderId]);

    useEffect(() => {
        if (isOpen && orderId) loadCalculations();
    }, [isOpen, orderId, loadCalculations]);

    // Реквизиты заказчика: хозяин — клиент, в заказ подтягиваются.
    const [requisites, setRequisites] = useState<any | null>(null);
    // Какие письма раскрыты: письмо читается целиком в самой ленте.
    const [openedEmails, setOpenedEmails] = useState<Set<string>>(new Set());
    // Смена заказчика: заказ бывает заведён не на то юрлицо (требование
    // владельца 02.10.2026, как в RetailCRM — заказчика меняют тут же).
    const [customerPicker, setCustomerPicker] = useState(false);
    const [customerQuery, setCustomerQuery] = useState('');
    const [customerFound, setCustomerFound] = useState<any[]>([]);
    const [customerBusy, setCustomerBusy] = useState(false);

    const loadRequisites = useCallback(async () => {
        if (!orderId) return;
        try {
            const res = await fetch(`/api/orders/${orderId}/requisites`);
            setRequisites(await res.json());
        } catch {
            setRequisites(null);
        }
    }, [orderId]);

    useEffect(() => {
        if (isOpen && orderId) loadRequisites();
    }, [isOpen, orderId, loadRequisites]);


    const searchCustomers = async (query: string) => {
        setCustomerQuery(query);
        if (query.trim().length < 3) {
            setCustomerFound([]);
            return;
        }
        try {
            const res = await fetch(`/api/clients?q=${encodeURIComponent(query.trim())}&pageSize=20`);
            const payload = await res.json();
            setCustomerFound(Array.isArray(payload.clients) ? payload.clients : (payload.rows || payload.items || []));
        } catch {
            setCustomerFound([]);
        }
    };

    const changeCustomer = async (client: any) => {
        const name = client.company_name || client.contact_name || `клиент ${client.id}`;
        if (!confirm(`Передать заказ заказчику «${name}»? Реквизиты подтянутся из его карточки.`)) return;

        setCustomerBusy(true);
        try {
            const res = await fetch(`/api/orders/${orderId}/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: Number(client.id) }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сменить заказчика');

            setCustomerPicker(false);
            setCustomerQuery('');
            setCustomerFound([]);
            await fetchDetails();
            await loadRequisites();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setCustomerBusy(false);
        }
    };

    // Крошка в шапке — человеческим номером заказа («Заказ #1021А»), а не
    // внутренним идентификатором: у своих заказов он вида 900000021 и человека
    // только путает (поймано 02.10.2026).
    const { setCrumbs } = useBreadcrumbs();
    const humanOrderNumber = data?.order?.number ?? data?.raw_payload?.number ?? null;

    useEffect(() => {
        if (!isOpen) return;
        setCrumbs([{ label: `Заказ #${humanOrderNumber ?? orderId}`, back: onClose }]);
        return () => setCrumbs([]);
    }, [isOpen, humanOrderNumber, orderId, onClose, setCrumbs]);

    // Ссылки на карточки товаров сайта — по id товара на сайте, запасным
    // ключом по артикулу.
    useEffect(() => {
        const siteIds = Array.from(new Set(draftItems.map((row) => row.siteId).filter(Boolean))) as string[];
        const articles = Array.from(new Set(draftItems.map((row) => row.article).filter(Boolean))) as string[];
        // Идентификатор 1С — самый надёжный ключ: по id сайта и артикулу товары
        // уже не сходятся (номера в заказах ушли за 40 000, в каталоге сайта
        // кончаются на 29 420).
        const xmlIds = Array.from(new Set(draftItems.map((row) => row.xmlId).filter(Boolean))) as string[];
        if (!siteIds.length && !articles.length && !xmlIds.length) { setCatalogLinks({}); return; }

        let cancelled = false;
        fetch('/api/catalog/links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteIds, articles, xmlIds }),
        })
            .then((r) => r.json())
            .then((payload) => { if (!cancelled) setCatalogLinks(payload.links || {}); })
            .catch(() => { if (!cancelled) setCatalogLinks({}); });

        return () => { cancelled = true; };
        // Зависим от набора артикулов, а не от самих позиций: иначе запрос
        // уходил бы на каждое нажатие в поле количества.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftItems.map((row) => `${row.siteId ?? ''}/${row.article ?? ''}/${row.xmlId ?? ''}`).join('|')]);

    const takeCalculation = async (item: { type: string; id: string; title: string }) => {
        if (!confirm(`Взять «${item.title}» из калькулятора в состав заказа?`)) return;
        setCalcTaking(`${item.type}:${item.id}`);
        try {
            const res = await fetch(`/api/orders/${orderId}/calculations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: item.type, id: item.id }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось взять расчёт');
            await fetchDetails();
            await loadCalculations();
        } catch (e: any) {
            alert(e.message || 'Не удалось взять расчёт');
        } finally {
            setCalcTaking(null);
        }
    };

    useEffect(() => {
        if (!printOpen || printTemplates.length) return;
        fetch('/api/settings/templates?kind=document&active=true')
            .then((r) => r.json())
            .then((d) => setPrintTemplates(d.document || []))
            .catch(() => setPrintTemplates([]));
    }, [printOpen, printTemplates.length]);

    useEffect(() => {
        if (isOpen && orderId) {
            fetchDetails();
            fetchQualityScore(); // Fetch score immediately on open for the header
            setViewTab('card');
            setQualityCalls([]);
            setQualityError(null);
            setSelectedCallIndex(0);
            setQualityMobileTab('calls');
            setQualityFetched(false);
            setTranscribing(false);
            setCounterpartyScore(null);
        }
    }, [isOpen, orderId, fetchQualityScore]);

    const fetchDetails = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/details`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setData(json);

            // Карточка редактируемая: сразу кладём значения в черновик, чтобы
            // менеджер правил их на месте, а не в отдельном окне.
            const payload = json?.raw_payload ?? {};
            const rawItems = Array.isArray(payload.items) ? payload.items : [];
            setDraftItems(rawItems.map((item: any) => ({
                id: item.id ?? null,
                // В каталоге сайта кавычки местами записаны кодом HTML
                // («&quot;»), и в составе он показывался буквами. Раскодируем
                // у себя; сайт не трогаем (решение владельца 02.10.2026).
                name: decodeEntities(String(item.offer?.displayName || item.offer?.name || item.productName || 'Позиция')),
                quantity: Number(item.quantity || 0),
                /**
                 * Цена — ВСЕГДА базовая, до скидки.
                 *
                 * Если `initialPrice` в позиции нет, восстанавливаем её из цены
                 * со скидкой: иначе карточка покажет уценённую цену, человек её
                 * сохранит, и базовая цена потеряется навсегда — скидка окажется
                 * «вшита» в цену и перестанет убираться (заказ 900055: 96 930
                 * превратились в 82 390, Ирина Гордеева 06.10.2026 — «убирала
                 * скидку из позиций, не удалялась»).
                 */
                price: Number(item.initialPrice ?? (Number(item.price ?? 0) + Number(item.discountTotal ?? 0))),
                /**
                 * Скидка позиции: рублями и процентом — два РАЗНЫХ поля, и они
                 * складываются.
                 *
                 * `discountTotal` — уже посчитанный итог обеих скидок на
                 * единицу. Поэтому подставлять его в рублёвое поле можно
                 * только когда процента нет: иначе скидка считается дважды.
                 * Ирина Гордеева 05.10.2026: «ставлю 15%, сразу даёт 30%
                 * скидку» — ровно этот случай.
                 */
                discount: Number(
                    item.discountManualAmount
                    ?? (Number(item.discountManualPercent ?? 0) > 0 ? 0 : (item.discountTotal ?? 0)),
                ),
                // Скидка процентом по позиции — третий вид скидки RetailCRM
                // (`discountManualPercent`). Правится в строке, рядом с рублями.
                discountPercent: Number(item.discountManualPercent ?? 0),
                article: item.offer?.article ?? null,
                // id товара на сайте: по нему строится ссылка на его карточку.
                siteId: item.offer?.externalId ? String(item.offer.externalId) : null,
                xmlId: item.offer?.xmlId ?? null,
            })));
            setDraftOrderDiscount({
                amount: Number(payload.discountManualAmount ?? 0),
                percent: Number(payload.discountManualPercent ?? 0),
            });
            setDraftFields({});
            fetch(`/api/orders/${orderId}/sellers`)
                .then((r) => r.json())
                .then((payload) => setSellerOptions(payload.sellers || []))
                .catch(() => setSellerOptions([]));
            // Комментарии — из своих полей, а не из снимка (закон 06.10.2026).
            setDraftClientComment(String(json?.order?.customerComment ?? ''));
            setDraftManagerComment(String(json?.order?.managerComment ?? ''));
            setDirty(false);
            setSaveNote(null);
            // Проверка контрагента по ИНН — в фоне, не блокирует показ карточки заказа.
            const inn = json?.order?.inn || json?.raw_payload?.inn || json?.order?.customer_inn;
            if (inn) {
                void fetchCounterpartyScore(inn);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const setField = (key: string, value: any) => {
        setDraftFields((prev) => ({ ...prev, [key]: value }));
        setDirty(true);
    };

    /** Значение поля: сначала из черновика, потом из заказа. */
    const fieldValue = (key: string, original: any) => (key in draftFields ? draftFields[key] : original);

    const changeItem = (index: number, patch: Partial<{ name: string; quantity: number; price: number; discount: number; discountPercent: number }>) => {
        setDraftItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
        setDirty(true);
    };

    const removeItem = (index: number) => {
        setDraftItems((prev) => prev.filter((_, i) => i !== index));
        setDirty(true);
    };

    const addItem = (item?: { id: string; name: string; price: number; article?: string | null }) => {
        if (!item) return; // товары только из каталога: руками названия не вводим
        // id из каталога — это id товара на сайте: он же ключ к его карточке.
        setDraftItems((prev) => [...prev, { id: null, name: item.name, quantity: 1, price: item.price, discount: 0, discountPercent: 0, article: item.article ?? null, siteId: item.id, xmlId: item.id }]);
        setDirty(true);
        setCatalogQuery('');
        setCatalogFound([]);
    };

    /** Сохранить правку заказа в CRM. Пока обе системы живые, заказ меняется там. */
    const saveOrder = async () => {
        setSavingOrder(true);
        setSaveNote(null);
        setFieldErrors({});
        try {
            const res = await fetch(`/api/orders/${orderId}/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: draftItems.map((row) => ({
                        id: row.id ?? null,
                        name: row.name,
                        quantity: row.quantity,
                        price: row.price,
                        discountAmount: row.discount || 0,
                        discountPercent: row.discountPercent || 0,
                        article: row.article ?? null,
                        siteId: row.siteId ?? null,
                        xmlId: row.xmlId ?? null,
                    })),
                    discountAmount: draftOrderDiscount.amount || 0,
                    discountPercent: draftOrderDiscount.percent || 0,
                    customerComment: draftClientComment,
                    managerComment: draftManagerComment,
                    // Правка остальных полей: раскладываем ключи по местам заказа.
                    contact: {
                        ...Object.fromEntries(
                            Object.entries(draftFields)
                                .filter(([key]) => !key.includes('.'))
                                .map(([key, value]) => [key, value]),
                        ),
                        /**
                         * «Контакт» — ОДНО поле, и в нём всё имя целиком.
                         *
                         * Показывается оно как «фамилия имя отчество», а правится
                         * в firstName. Поэтому мусорная фамилия не стиралась:
                         * человек убирал «ИИ-Лид Ирина», сохранял, а «ИИ-Лид»
                         * сидел в lastName и возвращался на экран и в счёт
                         * (Елена Парфёнова 06.10.2026: «удаляю, сохраняю, не
                         * убирает»). Правим имя — чистим и остальные части.
                         */
                        ...('firstName' in draftFields ? { lastName: '', patronymic: '' } : {}),
                    },
                    // Юрлицо заказа едет своим полем: в `contact` его класть нельзя —
                    // RetailCRM такого поля у заказа не знает.
                    ...('order.site' in draftFields ? { site: draftFields['order.site'] || null } : {}),
                    // Единица срока изготовления — наша колонка, в RetailCRM её нет.
                    ...('order.srok_izgot_edinica' in draftFields
                        ? { productionDaysUnit: draftFields['order.srok_izgot_edinica'] || null }
                        : {}),
                    // Причина отмены словами — тоже наша колонка.
                    ...('order.prichina_otmeny_text' in draftFields
                        ? { cancelReasonText: draftFields['order.prichina_otmeny_text'] || null }
                        : {}),
                    customFields: Object.fromEntries(
                        Object.entries(draftFields)
                            .filter(([key]) => key.startsWith('cf.'))
                            .map(([key, value]) => [key.slice(3), value]),
                    ),
                    delivery: Object.fromEntries(
                        Object.entries(draftFields)
                            .filter(([key]) => key.startsWith('delivery.'))
                            .map(([key, value]) => [key.slice('delivery.'.length), value]),
                    ),
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                // Сервер называет поля и беды поимённо — раскладываем их по рамкам.
                const problems: Array<{ field: string; label: string; message: string }> = payload.problems || [];
                if (problems.length) {
                    setFieldErrors(Object.fromEntries(problems.map((p) => [p.field, p.message])));
                }
                throw new Error(payload.error || 'Не удалось сохранить');
            }
            setSaveNote(payload.changed?.length ? `Сохранено: ${payload.changed.join(', ')}` : 'Изменений не было');
            setDirty(false);
            void fetchDetails();
        } catch (e: any) {
            setSaveNote(e.message);
        } finally {
            setSavingOrder(false);
        }
    };

    const fetchCounterpartyScore = async (inn: string) => {
        setCounterpartyScoreLoading(true);
        try {
            const resp = await fetch('/api/legal/counterparty/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inn })
            });
            if (resp.ok) {
                const score = await resp.json();
                setCounterpartyScore(score);
            }
        } catch {}
        finally {
            setCounterpartyScoreLoading(false);
        }
    };

    const fetchQualityCalls = useCallback(async () => {
        if (!orderId) return;
        setQualityCallsLoading(true);
        try {
            const res = await fetch(`/api/okk/scores/${orderId}/calls`);
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error || 'Не удалось загрузить звонки');
            }
            const calls = Array.isArray(json.calls) ? json.calls : [];
            setQualityCalls(calls);
            if (calls.length > 0) {
                const firstWithTranscript = calls.findIndex((call: any) => Boolean(call.transcript));
                setSelectedCallIndex(firstWithTranscript >= 0 ? firstWithTranscript : 0);
            } else {
                setSelectedCallIndex(0);
            }
            setQualityMobileTab('calls');
        } catch (e: any) {
            console.error(e);
            setQualityError(e.message || 'Не удалось загрузить качество');
        } finally {
            setQualityCallsLoading(false);
        }
    }, [orderId]);

    const loadQualityData = useCallback(async () => {
        setQualityError(null);
        await Promise.allSettled([fetchQualityCalls()]);
        setQualityFetched(true);
    }, [fetchQualityCalls]);

    const handleQualityRefresh = useCallback(() => {
        setQualityFetched(false);
    }, []);

    const handleTranscribeCall = useCallback(async () => {
        const activeCall = qualityCalls[selectedCallIndex];
        if (!activeCall?.recording_url || !activeCall?.telphin_call_id || transcribing) return;
        setTranscribing(true);
        try {
            const res = await fetch('/api/okk/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callId: activeCall.telphin_call_id,
                    recordingUrl: activeCall.recording_url
                })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || 'Ошибка при транскрибации');
            }
            await fetchQualityCalls();
            setQualityMobileTab('transcript');
        } catch (e: any) {
            alert(`Ошибка транскрибации: ${e.message || 'неизвестная ошибка'}`);
        } finally {
            setTranscribing(false);
        }
    }, [qualityCalls, selectedCallIndex, transcribing, fetchQualityCalls]);

    useEffect(() => {
        if (!isOpen || viewTab !== 'quality' || !orderId) return;
        if (qualityFetched) return;
        loadQualityData();
    }, [isOpen, viewTab, orderId, qualityFetched, loadQualityData]);

    const headerPayload = data?.raw_payload ?? null;
    const headerContact = headerPayload?.contact ?? {};
    const headerCustomer = headerPayload?.customer ?? {};
    const headerCustomFields = (headerPayload?.customFields ?? {}) as Record<string, any>;
    const statusCode = data?.order?.status || headerPayload?.status || headerPayload?.status?.code;
    const statusLabel = statusCode ? statusName(statusCode) : null;
    const headerBadges = (
        [
            headerCustomer?.vip || headerContact?.vip
                ? { label: 'VIP', className: 'bg-purple-100 text-purple-700' }
                : null,
            headerCustomer?.bad || headerContact?.bad
                ? { label: 'BAD', className: 'bg-red-100 text-red-700' }
                : null,
            headerCustomFields?.control
                ? { label: 'Контроль', className: 'bg-amber-100 text-amber-700' }
                : null,
        ].filter(Boolean) as { label: string; className: string }[]
    );

    if (!isOpen) return null;

    const formatCurrency = (value?: number | null) => {
        if (value === null || value === undefined) return '—';
        return value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
    };

    const formatDate = (value?: string | null) => {
        if (!value) return '—';
        return new Date(value).toLocaleDateString('ru-RU');
    };

    const formatDateTime = (value?: string | null) => {
        if (!value) return '—';
        return new Date(value).toLocaleString('ru-RU');
    };

    const renderCardContent = () => {
        if (!data) return null;

        const order = data.order ?? {};
        const payload = data.raw_payload ?? {};
        const delivery = payload.delivery ?? {};
        const shipping = delivery.shipping ?? {};
        const address = delivery.address ?? {};
        const contact = payload.contact ?? {};
        const customer = payload.customer ?? {};
        // Карточку клиента для ссылок ищет сервер: у заказа на живого
        // человека это компания, где он контактное лицо.
        const clientCardId = data.clientCardId ?? null;
        const customFields = (payload.customFields ?? {}) as Record<string, any>;
        const paymentSource = payload.payments ?? order.payments ?? {};
        const paymentEntries = toArray(paymentSource);
        const contactPhones = (Array.isArray(contact.phones) ? contact.phones.map((p: any) => p.number).filter(Boolean) : []) as string[];
        const storedPhones = (Array.isArray(order.customer_phones) ? order.customer_phones : []) as string[];
        // Телефоны: один и тот же номер приходит из нескольких мест (поле
        // заказа, колонка, контакт, карточка клиента) и записан по-разному —
        // «+7 (812) 670-23-03» и «+78126702303». Без склейки по цифрам все три
        // поля показывали рабочий номер, а мобильный не был виден вовсе
        // (поймано 02.10.2026).
        const normalizedPhones = uniquePhones([
            payload.phone,
            payload.additionalPhone,
            order.phone,
            ...(Array.isArray(contactPhones) ? contactPhones : []),
            ...(Array.isArray(storedPhones) ? storedPhones : []),
            customFields.dop_telefon2,
            customFields.dop_telefon3,
        ]);
        const [primaryPhone, secondaryPhone, thirdPhone] = normalizedPhones;
        const segments = Array.isArray(contact.segments) ? contact.segments.map((segment: any) => segment.name).filter(Boolean).join(', ') : null;
        // Название компании: из заказа, а если его там нет — из карточки
        // клиента (решение после замечания Лены 05.10.2026).
        const companyName = pickValue(customer.nickName, customer.companyName, customer.name, data.clientCompanyName);
        const productCategory = names.field('typ_castomer', pickValue(customFields.typ_castomer, customFields.tovarnaya_kategoriya, customFields.product_category, payload.category));
        const nextContact = pickValue(customFields.data_kontakta, customFields.next_contact_date, customFields.follow_up_date);
        const purchaseForm = names.field('typ_customer_margin', pickValue(customFields.typ_customer_margin, customFields.purchase_form, customFields.forma_zakupki));
        // Часовой пояс — справочник chasovoi_poias из RetailCRM, не хардкод.
        const timezoneValue = names.field('chasovoi_poias', pickValue(customFields.chasovoi_poias, customFields.timezone)) || null;
        const logisticDeadline = pickValue(customFields.srok_izgot, shipping.productionDays, delivery.productionDays);
        const logisticComment = pickValue(customFields.komment_diveleri, shipping.comment, delivery.comment);
        const logisticWarehouse = pickValue(customFields.sklad_otgruzki, shipping.warehouse);
        const logisticNeedBy = pickValue(customFields.kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo);
        const logisticBuyerType = pickValue(customFields.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete);
        const logisticReceiver = pickValue(customFields.naimenovanie_gruzopoluchatelya);
        const dsDocument = pickValue(customFields.datacheta);
        const marginValue = pickValue(customFields.marzha);
        const contractBasis = names.field('osnovanie_podpisi', pickValue(customFields.osnovanie_podpisi));
        const logisticAddress = pickValue(address.text, [address.region, address.city, address.street, address.house, address.building].filter(Boolean).join(', '));
        const logisticIndex = pickValue(address.index);
        const logisticCity = pickValue(address.city);
        // «Город доставки (менеджерам ОП)» — отдельное поле RetailCRM, не адрес.
        const deliveryCityManager = pickValue(customFields.gorod_dostavki_menedzheram_op);
        const logisticRegion = pickValue(address.region);
        const logisticCost = toNumber(pickValue(delivery.cost, order.delivery_cost));
        const logisticTime = pickValue(delivery.time, customFields.vremya_dostavki);
        const operatorComment = pickValue(order.managerComment);
        const clientComment = pickValue(order.customerComment);
        const additionalEmail = pickValue(customFields.additional_email, customFields.dopolnitelnyi_email, payload.additionalEmail);
        const totalSummValue = toNumber(order.totalsumm);
        /**
         * Статус берём ТОЛЬКО из колонки заказа — она единственный источник
         * правды (закон владельца 06.10.2026).
         *
         * Раньше читали сначала копию внутри raw_payload и лишь потом колонку.
         * Копию обновляет перенос из RetailCRM, а колонку — наше приложение;
         * перенос отключили, копия застыла, и карточка показывала старый
         * статус. На этом же разъезде я 06.10.2026 затёр статусы 16 заказов:
         * заказы, переданные в производство, вернулись в «Счёт на оплате».
         */
        const orderStatusCode = pickValue(order.status, payload.status?.code, payload.status);
        const countryValue = formatCountryName(pickValue(order.countryIso, address.countryIso));
        const createdDate = formatDateTime(order.created_at);
        const statusUpdated = formatDateTime(pickValue(payload.statusUpdatedAt, order.updated_at));
        const privilegeType = pickValue(order.privilegeType);
        // Имя контакта: сначала то, что стоит в самом заказе — его правит
        // менеджер в этой карточке. `contact` приезжает из RetailCRM и держит
        // латиницу («Belyaeva Irina»), поэтому он только запасной вариант:
        // иначе правка «Беляева Ирина» сохранялась, но на экран не попадала.
        const contactName = [payload.lastName, payload.firstName, payload.patronymic].filter(Boolean).join(' ').trim()
            || [contact.lastName, contact.firstName, contact.patronymic].filter(Boolean).join(' ').trim();
        const expectedDelivery = pickValue(customFields.when_need_delivery, customFields.plan_delivery_date);
        const paymentsSummary = paymentEntries.length > 0 ? paymentEntries : [];
        const isOwn = Boolean(order.is_own);
        const crmBase = (process.env.NEXT_PUBLIC_RETAILCRM_URL || '').replace(/\/+$/, '');
        const crmOrderUrl = crmBase && order.order_id ? `${crmBase}/orders/${order.order_id}/edit` : null;
        const items = Array.isArray(payload.items) ? payload.items : toArray(order.items);
        const computedItemsTotal = items.reduce((sum: number, item: any) => {
            const price = extractItemPrice(item);
            const qty = extractItemQuantity(item);
            return sum + price * qty;
        }, 0);

        return (
            <div className="space-y-12">
                <section id="order-common" className="space-y-3">
                    {/* Статус показываем один раз — в баре сверху. Три одинаковых
                        плашки на экране только мешали (требование владельца 01.10.2026).
                        Блок сворачивается, и это запоминается за человеком
                        (решение владельца 05.10.2026). */}
                    <CardSection id="order-common" title="Основное">
                        <div className="grid gap-2 md:grid-cols-2">
                            <InfoField label="Страна" required value={countryValue} />
                            <InfoField label="Тип заказа" value={names.resolve('orderType', order.orderType) || 'Не указан'} />
                            {/* Менеджер меняется прямо здесь, с причиной: раньше
                                менеджер писал владельцу в Telegram, а тот переводил
                                руками (решение владельца 05.10.2026). */}
                            <ManagerTransfer
                                orderKey={orderId}
                                currentManagerId={order.manager_id}
                                currentManagerName={order.manager_name || null}
                                onDone={() => void fetchDetails()}
                            />
                            {/* Юрлицо заказа: от него идут реквизиты продавца, расчётный
                                счёт и НДС (у АО «ЗВТО» его нет). Менеджер меняет его сам —
                                раньше поле было только для чтения, и заказ, заведённый не
                                на то юрлицо, приходилось переделывать (Лена Парфёнова
                                05.10.2026). У заказов RetailCRM магазин живёт там и её API
                                его не меняет, поэтому выбор только у своих заказов. */}
                            {isOwn ? (
                                <EditField fieldKey="order.site"
                                    label="Магазин"
                                    required
                                    value={fieldValue('order.site', payload.site || order.site || '')}
                                    onChange={(v) => setField('order.site', v)}
                                    options={sellerOptions.map((option) => ({ value: option.code, label: option.name }))}
                                />
                            ) : (
                                <InfoField label="Магазин" required value={names.resolve('site', payload.site || order.site || payload.slug) || '—'} />
                            )}
                        </div>
                    </CardSection>

                    <CardSection id="order-control" title="Контроль">
                        <div className="grid md:grid-cols-3 gap-2">
                            <EditField fieldKey="cf.typ_castomer"
                                label="Категория товара"
                                required
                                value={fieldValue('cf.typ_castomer', customFields.typ_castomer || '')}
                                options={names.fieldOptions('typ_castomer')}
                                onChange={(v) => setField('cf.typ_castomer', v)}
                            />
                            <EditField fieldKey="cf.data_kontakta" label="Дата следующего контакта" type="date" value={fieldValue('cf.data_kontakta', String(customFields.data_kontakta || '').slice(0, 10))} onChange={(v) => setField('cf.data_kontakta', v)} />
                            <EditField fieldKey="cf.typ_customer_margin"
                                label="Форма закупки"
                                value={fieldValue('cf.typ_customer_margin', customFields.typ_customer_margin || '')}
                                options={names.fieldOptions('typ_customer_margin')}
                                onChange={(v) => setField('cf.typ_customer_margin', v)}
                            />
                        </div>
                    </CardSection>
                </section>

                <section id="order-customer" className="space-y-3">
                    {/* Клиент и его реквизиты — один блок (требование владельца
                        02.10.2026: «реквизиты заказчика и клиент — это один блок
                        данных», как в RetailCRM). Заказчика можно поменять: заказ
                        бывает заведён не на то юрлицо. */}
                    <CardSection
                        id="order-client"
                        title="Клиент"
                        action={
                            <div className="flex items-center gap-3 text-xs">
                                {clientCardId && (
                                    <a href={`/clients/${clientCardId}`} className="text-blue-700 hover:underline">
                                        карточка заказчика
                                    </a>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setCustomerPicker((open) => !open)}
                                    className="font-semibold text-blue-700 hover:underline"
                                >
                                    {customerPicker ? 'отменить' : 'выбрать другого заказчика'}
                                </button>
                            </div>
                        }
                    >
                        {customerPicker && (
                            <div className="mb-3 border border-gray-300">
                                <input
                                    value={customerQuery}
                                    onChange={(e) => searchCustomers(e.target.value)}
                                    placeholder="Название, ИНН, телефон или почта заказчика"
                                    className="w-full border-b border-gray-200 px-3 py-2 text-xs"
                                    autoFocus
                                />
                                {customerQuery.trim().length > 0 && customerQuery.trim().length < 3 && (
                                    <div className="px-3 py-2 text-[11px] text-gray-500">Введите хотя бы три знака</div>
                                )}
                                {customerFound.map((client: any) => (
                                    <button
                                        key={client.id}
                                        type="button"
                                        disabled={customerBusy}
                                        onClick={() => changeCustomer(client)}
                                        className="block w-full border-b border-gray-100 px-3 py-2 text-left text-xs hover:bg-gray-50 disabled:text-gray-400"
                                    >
                                        <span className="font-semibold text-gray-900">{client.company_name || client.contact_name || `Клиент ${client.id}`}</span>
                                        <span className="ml-2 text-[11px] text-gray-500">
                                            {[client.inn ? `ИНН ${client.inn}` : null, client.orders_count ? `заказов ${Number(client.orders_count).toLocaleString('ru-RU')}` : null]
                                                .filter(Boolean).join(' · ')}
                                        </span>
                                    </button>
                                ))}
                                {customerQuery.trim().length >= 3 && !customerFound.length && (
                                    <div className="px-3 py-2 text-[11px] text-gray-500">Таких заказчиков не нашли</div>
                                )}
                            </div>
                        )}

                        <div className="grid md:grid-cols-2 gap-2">
                            <InfoField label="Компания" value={companyName || '—'} />
                            <EditField fieldKey="firstName" label="Контакт" value={fieldValue('firstName', contactName)} onChange={(v) => setField('firstName', v)} />
                            <EditField fieldKey="email" label="Email" value={fieldValue('email', payload.email || contact.email || customer.email || '')} onChange={(v) => setField('email', v)} />
                            {/* Звонок набирает то, что сейчас в поле: номер часто
                                правят прямо здесь и звонят, не сохраняя заказ. */}
                            <EditField fieldKey="phone"
                                // Местное время клиента в подписи поля: звонок в
                                // 17:00 по Москве — это полночь во Владивостоке
                                // (просьба Евгении Матвеевой 05.10.2026).
                                label={phoneLabel('Основной телефон', String(fieldValue('phone', primaryPhone || '') ?? ''))}
                                value={fieldValue('phone', primaryPhone || '')}
                                onChange={(v) => setField('phone', v)}
                                action={<PhoneFieldCall phone={String(fieldValue('phone', primaryPhone || '') ?? '')} managerId={callManagerId} orderId={String(orderId)} />}
                            />
                            {/* Второй номер — поле заказа `additionalPhone`: читаем и
                                пишем одно и то же место, иначе введённый номер
                                пропадал с экрана после сохранения. */}
                            <EditField fieldKey="additionalPhone"
                                label={phoneLabel('Доп. телефон (2)', String(fieldValue('additionalPhone', payload.additionalPhone || secondaryPhone || '') ?? ''))}
                                value={fieldValue('additionalPhone', payload.additionalPhone || secondaryPhone || '')}
                                onChange={(v) => setField('additionalPhone', v)}
                                action={<PhoneFieldCall phone={String(fieldValue('additionalPhone', payload.additionalPhone || secondaryPhone || '') ?? '')} managerId={callManagerId} orderId={String(orderId)} />}
                            />
                            <EditField fieldKey="cf.dop_telefon3"
                                label="Доп. телефон (3)"
                                value={fieldValue('cf.dop_telefon3', customFields.dop_telefon3 || thirdPhone || '')}
                                onChange={(v) => setField('cf.dop_telefon3', v)}
                                action={<PhoneFieldCall phone={String(fieldValue('cf.dop_telefon3', customFields.dop_telefon3 || thirdPhone || '') ?? '')} managerId={callManagerId} orderId={String(orderId)} />}
                            />
                            <EditField fieldKey="cf.poshta" label="Доп. Email" value={fieldValue('cf.poshta', additionalEmail || '')} onChange={(v) => setField('cf.poshta', v)} />
                        </div>

                        {/* Реквизиты заказчика из карточки заказа убраны по
                            решению владельца 06.10.2026: «реквизиты компании тут
                            не надо отображать, достаточно контактов и
                            наименования». Хозяин реквизитов — карточка клиента,
                            в счёт и КП они подставляются оттуда сами.

                            Осталось одно предупреждение и только когда
                            реквизитов нет НИГДЕ: без него счёт ушёл бы клиенту
                            пустым, и менеджер узнал бы об этом только от него. */}
                        {requisites
                            && requisites.client?.source !== 'client'
                            && requisites.client?.source !== 'order' && (
                            <p className="mt-3 border-t border-gray-200 pt-3 text-xs text-amber-800">
                                Реквизитов нет ни в карточке клиента, ни в заказе — счёт и договор
                                напечатаются без них.
                                {clientCardId && (
                                    <>
                                        {' '}
                                        <a href={`/clients/${clientCardId}`} className="text-blue-700 hover:underline">
                                            Внести в карточке клиента
                                        </a>
                                    </>
                                )}
                            </p>
                        )}
                    </CardSection>

                    <CardSection id="order-client-extra" title="Дополнительно о клиенте">
                        <div className="grid md:grid-cols-2 gap-2">
                            <EditField fieldKey="cf.dolzhnost" label="Должность" value={fieldValue('cf.dolzhnost', customFields.dolzhnost || '')} onChange={(v) => setField('cf.dolzhnost', v)} />
                            <InfoField label="Сегмент клиента" value={segments || '—'} />
                            <EditField fieldKey="cf.sfera_deiatelnosti"
                                label="Сфера деятельности"
                                required
                                value={fieldValue('cf.sfera_deiatelnosti', customFields.sfera_deiatelnosti || '')}
                                options={names.fieldOptions('sfera_deiatelnosti')}
                                onChange={(v) => setField('cf.sfera_deiatelnosti', v)}
                            />
                            {/* Часовой пояс и причина отмены — обычные поля заказа,
                                их правит менеджер (Лена Парфёнова 05.10.2026:
                                «часовой пояс не активна строка»). Значения — из
                                справочника RetailCRM, не придуманные. */}
                            <EditField fieldKey="cf.chasovoi_poias"
                                label="Часовой пояс"
                                value={fieldValue('cf.chasovoi_poias', customFields.chasovoi_poias || '')}
                                options={names.fieldOptions('chasovoi_poias')}
                                onChange={(v) => setField('cf.chasovoi_poias', v)}
                            />
                            <InfoField label="Основание подписи" value={contractBasis || '—'} />
                            <EditField fieldKey="cf.kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo"
                                label="Когда нужно оборудование"
                                value={fieldValue('cf.kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo', customFields.kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo || logisticNeedBy || '')}
                                onChange={(v) => setField('cf.kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoyalo', v)}
                            />
                            <EditField fieldKey="cf.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete"
                                label="Для кого закупка"
                                value={fieldValue('cf.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete', customFields.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete || logisticBuyerType || '')}
                                onChange={(v) => setField('cf.vy_dlya_sebya_ili_dlya_zakazchika_priobretaete', v)}
                            />
                            <EditField fieldKey="cf.adres_fakt" label="Адрес фактический" value={fieldValue('cf.adres_fakt', customFields.adres_fakt || logisticAddress || '')} onChange={(v) => setField('cf.adres_fakt', v)} />
                        </div>
                    </CardSection>
                </section>

<section id="order-custom-fields" className="space-y-3">
                    <CardSection id="order-custom-fields" title="Дополнительные данные">
                        <div className="grid md:grid-cols-2 gap-2">
                            {/* Причину отмены пишут словами: список позволял
                                бездумно тыкать, а подробный текст даёт разбор
                                (решение владельца 05.10.2026). Код причины рядом
                                остался — по нему считается конверсия в зарплате. */}
                            <EditField fieldKey="order.prichina_otmeny_text"
                                label="Причина отмены (словами, подробно)"
                                value={fieldValue('order.prichina_otmeny_text', order?.prichina_otmeny_text || '')}
                                onChange={(v) => setField('order.prichina_otmeny_text', v)}
                            />
                            <EditField fieldKey="cf.prichiny_otmeny"
                                label="Причина отмены — тип для отчётов"
                                value={fieldValue('cf.prichiny_otmeny', customFields.prichiny_otmeny || payload.cancelReason || '')}
                                options={names.fieldOptions('prichiny_otmeny')}
                                onChange={(v) => setField('cf.prichiny_otmeny', v)}
                            />
                            <EditField fieldKey="cf.datacheta" label="Датасчёт" type="date" value={fieldValue('cf.datacheta', String(customFields.datacheta || '').slice(0, 10))} onChange={(v) => setField('cf.datacheta', v)} />
                        </div>
                    </CardSection>
                </section>

                <section id="order-list">
                    <div className="bg-white border border-gray-200 p-0 overflow-hidden">
                        {/* Состав правится прямо здесь: режима «только просмотр» у нас нет. */}
                        <div className="flex items-center justify-between gap-3 p-6 border-b">
                            <h3 className="text-lg font-semibold text-gray-900">Состав заказа</h3>
                            {/* Руками позиции не вводим: товары берутся из каталога
                                сайта (решение владельца 02.10.2026) — поиск ниже. */}
                            <span className="text-xs text-gray-500">Товары добавляются из каталога сайта — поиск ниже</span>
                        </div>

                        {/* Расчёты из калькулятора «Бот-Инженер». Находим по номеру
                            заказа, который менеджер вписал в калькуляторе. */}
                        {/* Блок видно всегда, даже когда расчётов нет: иначе менеджер
                            не знает, что такая связь вообще есть (закон «заглушки
                            видимы в интерфейсе»). */}
                        {(
                            <div className="border-b border-gray-200 px-6 py-4">
                                <div className="mb-2 flex items-baseline justify-between gap-3">
                                    <h4 className="text-sm font-semibold text-gray-900">Расчёты из калькулятора</h4>
                                    <span className="text-xs text-gray-500">по номеру заказа {data?.order?.number ?? orderId}</span>
                                </div>
                                {calcNote && <p className="mb-2 text-xs text-amber-800">{calcNote}</p>}
                                {calcItems.map((item) => (
                                    <div key={`${item.type}:${item.id}`} className="flex flex-wrap items-center gap-3 border border-gray-200 px-3 py-2 text-sm">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-gray-900">{item.title}</div>
                                            <div className="text-xs text-gray-500">
                                                {item.params && `${item.params} · `}
                                                {item.quantity > 1 && `${item.quantity} шт · `}
                                                {item.weightKg ? `${Math.round(item.weightKg).toLocaleString('ru-RU')} кг · ` : ''}
                                                {item.author || 'автор не указан'}
                                                {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString('ru-RU')}` : ''}
                                            </div>
                                        </div>
                                        <div className="text-sm font-semibold text-gray-900">{formatCurrency(item.price)}</div>
                                        {item.inOrder ? (
                                            <span className="text-xs text-gray-500">уже в заказе</span>
                                        ) : (
                                            <button
                                                onClick={() => takeCalculation(item)}
                                                disabled={calcTaking === `${item.type}:${item.id}`}
                                                className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:bg-gray-100 disabled:text-gray-400"
                                            >
                                                {calcTaking === `${item.type}:${item.id}` ? 'Берём…' : 'Взять из калькулятора'}
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {calcItems.length === 0 && !calcNote && (
                                    <p className="text-xs text-gray-500">
                                        Расчётов с этим номером заказа нет. Посчитайте изделие в калькуляторе
                                        «Бот-Инженер» и впишите там в поле «Номер заказа» номер{' '}
                                        {data?.order?.number ?? orderId} вместо «Б/Н» — расчёт появится здесь,
                                        и его можно будет взять в заказ одной кнопкой.
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="px-6 pt-4">
                            <input
                                value={catalogQuery}
                                onChange={(e) => {
                                    const text = e.target.value;
                                    setCatalogQuery(text);
                                    if (catalogTimer.current) clearTimeout(catalogTimer.current);
                                    if (text.trim().length < 3) { setCatalogFound([]); setCatalogNote(null); return; }
                                    // Запрос не на каждую букву: каталог живёт в соседнем
                                    // проекте, а цену уточняет сайт.
                                    catalogTimer.current = setTimeout(async () => {
                                        try {
                                            const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(text.trim())}`);
                                            const payload = await res.json();
                                            setCatalogFound(payload.items || []);
                                            setCatalogNote(
                                                payload.unavailable
                                                    ? `Каталог сайта не подключён: ${payload.note || 'нет доступа'}. Позицию можно вписать руками.`
                                                    : (payload.items || []).length === 0
                                                        ? 'На сайте ничего не нашлось — впишите позицию руками.'
                                                        : payload.note || null,
                                            );
                                        } catch {
                                            setCatalogFound([]);
                                            setCatalogNote('Каталог сайта не ответил. Позицию можно вписать руками.');
                                        }
                                    }, 300);
                                }}
                                placeholder="Найти товар на сайте и добавить в заказ"
                                className="w-full border border-gray-300 px-3 py-2 text-sm"
                            />
                            {catalogNote && (
                                <p className="mt-1 text-xs text-amber-800">{catalogNote}</p>
                            )}
                            {catalogFound.length > 0 && (
                                <div className="mt-1 max-h-48 overflow-auto border border-gray-200">
                                    {catalogFound.map((found) => {
                                        const variants = found.variants ?? [];
                                        const opened = openVariants === found.id;

                                        return (
                                            <div key={found.id} className="border-b border-gray-100">
                                                <button
                                                    onClick={() => {
                                                        // Есть размеры — сначала выбираем, какой именно:
                                                        // без этого в заказ попадала родительская
                                                        // карточка (Лена Парфёнова 05.10.2026).
                                                        if (variants.length) {
                                                            setOpenVariants(opened ? null : found.id);
                                                            return;
                                                        }
                                                        addItem({ id: found.id, name: found.name, price: found.price, article: found.article ?? null });
                                                    }}
                                                    className="block w-full px-3 py-2 text-left text-sm hover:bg-amber-50"
                                                >
                                                    <div className="text-gray-900">
                                                        {found.name}
                                                        {variants.length > 0 && (
                                                            <span className="ml-2 text-xs font-semibold text-blue-700">
                                                                {opened ? 'скрыть размеры' : `размеров: ${variants.length}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {found.priceSource === 'none' ? 'Цена не указана' : formatCurrency(found.price)}
                                                        {' · '}
                                                        <span className={found.priceSource === 'none' ? 'text-amber-800' : ''}>
                                                            {priceSourceLabel(found.priceSource, found.priceLive)}
                                                        </span>
                                                    </div>
                                                </button>

                                                {opened && variants.map((variant) => (
                                                    <button
                                                        key={variant.id}
                                                        onClick={() => {
                                                            addItem({
                                                                id: found.id,
                                                                // Название с размером: по нему человек
                                                                // и узнаёт позицию в составе заказа.
                                                                name: itemNameWithVariant(found.name, variant.name),
                                                                price: variant.price || found.price,
                                                                article: variant.article ?? found.article ?? null,
                                                            });
                                                            setOpenVariants(null);
                                                        }}
                                                        className="block w-full border-t border-gray-100 bg-gray-50 px-6 py-1.5 text-left text-sm hover:bg-amber-50"
                                                    >
                                                        <span className="text-gray-900">{variant.name}</span>
                                                        <span className="ml-2 text-xs text-gray-600">{formatCurrency(variant.price)}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="overflow-x-auto p-6">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                    <tr>
                                        {/* Номер позиции — узкой колонкой: места он не стоит. */}
                                        <th className="w-8 px-2 py-3 text-left">№</th>
                                        <th className="w-14 px-1 py-3 text-left">Фото</th>
                                        <th className="px-3 py-3 text-left">Товар / услуга</th>
                                        <th className="w-24 px-3 py-3 text-right">Кол-во</th>
                                        <th className="w-32 px-3 py-3 text-right">Цена</th>
                                        <th className="w-32 px-3 py-3 text-right">Скидка</th>
                                        <th className="w-36 px-3 py-3 text-right">Стоимость</th>
                                        <th className="w-10 px-3 py-3"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {draftItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="py-10 text-center text-gray-500">
                                                Позиций нет — найдите товар на сайте или добавьте руками.
                                            </td>
                                        </tr>
                                    ) : draftItems.map((row, index) => (
                                        <tr key={row.id ?? `new-${index}`} className="hover:bg-gray-50">
                                            <td className="w-8 px-2 py-2 align-top text-gray-500">{index + 1}</td>
                                            {/* Фото товара с карточки сайта: состав видно
                                                глазами, а не только по названию (просьба
                                                Лены Парфёновой 05.10.2026). Нет товара на
                                                сайте — пустая клетка, рамку не рисуем. */}
                                            <td className="w-14 px-1 py-2 align-top">
                                                {(() => {
                                                    const found = (row.xmlId && catalogLinks[`1c:${String(row.xmlId).split('#')[0]}`])
                                                        || (row.siteId && catalogLinks[`id:${row.siteId}`])
                                                        || (row.article && catalogLinks[`art:${row.article}`])
                                                        || null;
                                                    // При наведении фото увеличивается — как было в
                                                    // RetailCRM (просьба Ирины Гордеевой 05.10.2026):
                                                    // по клетке 48×48 шкаф от стеллажа не отличить.
                                                    return found?.image ? (
                                                        <ItemPhoto src={found.image} alt={row.name} />
                                                    ) : null;
                                                })()}
                                            </td>
                                            {/* Название не правится: товар берётся из базы сайта.
                                                Есть его карточка на сайте — название ведёт туда;
                                                архивного товара на сайте уже нет, тогда даём
                                                поиск (решение владельца 02.10.2026). */}
                                            <td className="px-3 py-2 align-top">
                                                {(() => {
                                                    const link = (row.xmlId && catalogLinks[`1c:${String(row.xmlId).split('#')[0]}`])
                                                        || (row.siteId && catalogLinks[`id:${row.siteId}`])
                                                        || (row.article && catalogLinks[`art:${row.article}`])
                                                        || null;
                                                    return link?.url ? (
                                                        <a
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="break-words font-medium leading-snug text-blue-700 hover:underline"
                                                            title="Открыть карточку товара на сайте"
                                                        >
                                                            {row.name}
                                                        </a>
                                                    ) : (
                                                        <div className="break-words leading-snug text-gray-900">
                                                            {row.name}
                                                            <a
                                                                href={siteSearchUrl(row.name)}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="ml-2 whitespace-nowrap text-[11px] font-normal text-blue-700 hover:underline"
                                                                title="Карточки этого товара на сайте нет — поискать похожий"
                                                            >
                                                                найти на сайте
                                                            </a>
                                                        </div>
                                                    );
                                                })()}
                                                {row.article && (
                                                    <div className="mt-0.5 font-mono text-[11px] text-gray-400">{row.article}</div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                <NumberInput
                                                    value={row.quantity}
                                                    onChange={(v: number | null) => changeItem(index, { quantity: Number(v) || 0 })}
                                                    className="w-full border border-gray-300 px-2 py-1 text-right"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                {/* Копейки не режем: цена со скидкой бывает дробной
                                                    (82 390,50), и округление до рублей при каждом
                                                    сохранении уводило сумму заказа (06.10.2026). */}
                                                <NumberInput
                                                    value={row.price}
                                                    maxFractionDigits={2}
                                                    onChange={(v: number | null) => changeItem(index, { price: Number(v) || 0 })}
                                                    className="w-full border border-gray-300 px-2 py-1 text-right"
                                                />
                                            </td>
                                            {/* Скидка на единицу товара — рублями и процентом, как в
                                                RetailCRM (`discountManualAmount` и
                                                `discountManualPercent`). Они складываются: так же
                                                считает и сама CRM. */}
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-1">
                                                    <NumberInput
                                                        value={row.discount}
                                                        maxFractionDigits={2}
                                                        onChange={(v: number | null) => changeItem(index, { discount: Math.max(0, Number(v) || 0) })}
                                                        className="w-full border border-gray-300 px-2 py-1 text-right"
                                                    />
                                                    <span className="text-xs text-gray-400">₽</span>
                                                    <NumberInput
                                                        value={row.discountPercent}
                                                        onChange={(v: number | null) => changeItem(index, { discountPercent: Math.min(100, Math.max(0, Number(v) || 0)) })}
                                                        className="w-14 border border-gray-300 px-2 py-1 text-right"
                                                    />
                                                    <span className="text-xs text-gray-400">%</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-right font-semibold text-gray-900">
                                                {formatCurrency(itemTotalWithDiscount({
                                                    price: row.price,
                                                    quantity: row.quantity,
                                                    discountAmount: row.discount,
                                                    discountPercent: row.discountPercent,
                                                }))}
                                                {(row.discount > 0 || row.discountPercent > 0) && (
                                                    <div className="text-xs font-normal text-gray-400 line-through">
                                                        {formatCurrency(Math.max(0, row.price * row.quantity))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <button
                                                    onClick={() => removeItem(index)}
                                                    className="text-gray-400 hover:text-red-600"
                                                    title="Убрать позицию"
                                                >
                                                    ×
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {/* Итоги считаем по составу, как в RetailCRM: отдельно
                            стоимость товаров, отдельно сумма скидок, и только
                            потом итог. Раньше скидки в карточке не было вовсе —
                            итог показывался без неё и расходился с CRM. */}
                        {(() => {
                            // Скидки считает общий модуль (lib/own-crm/discount.ts) —
                            // тем же счётом, что уходит в базу, КП и счёт.
                            const totals = orderTotals(
                                draftItems.map((row) => ({ price: row.price, quantity: row.quantity, discountAmount: row.discount, discountPercent: row.discountPercent })),
                                {
                                    discountAmount: draftOrderDiscount.amount,
                                    discountPercent: draftOrderDiscount.percent,
                                    deliveryCost: Number(logisticCost) || 0,
                                },
                            );
                            const itemsGross = totals.itemsGross;
                            const discountTotal = totals.discountTotal;
                            const delivery = totals.deliveryCost;
                            const ourTotal = totals.total;
                            // Итог, который знает RetailCRM: колонку обновляет синхронизация,
                            // а снимок состава (raw_payload) бывает старее её. Расхождение не
                            // прячем — иначе «скидка исчезла» выглядит как ошибка счёта.
                            const crmTotal = Number(toNumber(order.totalsumm) ?? 0);
                            const stale = crmTotal > 0 && Math.abs(crmTotal - ourTotal) > 1;

                            return (
                                <div className="flex flex-wrap items-center justify-end gap-6 px-6 py-4 bg-gray-50 border-t text-sm text-gray-600">
                                    {/* Разовая скидка на заказ — третий вид скидки в RetailCRM:
                                        рублями и процентом от стоимости товаров. */}
                                    <div className="flex items-center gap-2">
                                        <span>Разовая скидка:</span>
                                        <NumberInput
                                            value={draftOrderDiscount.amount}
                                            onChange={(v: number | null) => {
                                                setDraftOrderDiscount((prev) => ({ ...prev, amount: Math.max(0, Number(v) || 0) }));
                                                setDirty(true);
                                            }}
                                            className="w-24 border border-gray-300 px-2 py-1 text-right"
                                        />
                                        <span>₽</span>
                                        <NumberInput
                                            value={draftOrderDiscount.percent}
                                            onChange={(v: number | null) => {
                                                setDraftOrderDiscount((prev) => ({ ...prev, percent: Math.min(100, Math.max(0, Number(v) || 0)) }));
                                                setDirty(true);
                                            }}
                                            className="w-16 border border-gray-300 px-2 py-1 text-right"
                                        />
                                        <span>%</span>
                                    </div>
                                    <div>Стоимость товаров: {formatCurrency(itemsGross)}</div>
                                    <div className={discountTotal > 0 ? 'text-gray-900' : undefined}>
                                        Сумма скидок по заказу: {discountTotal > 0 ? `−${formatCurrency(discountTotal)}` : formatCurrency(0)}
                                    </div>
                                    <div>Стоимость доставки: {formatCurrency(delivery)}</div>
                                    <div className="font-semibold text-gray-900">
                                        Итого: {formatCurrency(ourTotal)}
                                    </div>
                                    {stale && (
                                        <div
                                            className="w-full text-right text-xs text-amber-800"
                                            title="Состав и скидки в карточке — из снимка заказа; синхронизация его ещё не обновила"
                                        >
                                            По данным RetailCRM: {formatCurrency(crmTotal)} — состав в карточке из устаревшего снимка
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                    <div className="grid lg:grid-cols-3 gap-6">
                        <div className="bg-white border border-gray-200 p-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Комментарий клиента</h4>
                            <textarea
                                value={draftClientComment}
                                onChange={(e) => { setDraftClientComment(e.target.value); setDirty(true); }}
                                rows={6}
                                placeholder="Что просит клиент"
                                className="w-full border border-gray-200 bg-white p-3 text-sm text-gray-800"
                            />
                        </div>
                        <div className="bg-white border border-gray-200 p-4">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Комментарий менеджера</h4>
                            {/* Новая запись отдельным полем: дату, время и автора
                                ставит система, а запись ложится наверх ленты
                                (решение владельца 05.10.2026). Раньше менеджер
                                писал «05.10» руками и терялся, где свежее. */}
                            <textarea
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                rows={3}
                                placeholder="Новая запись: что сделали, о чём договорились"
                                className="w-full border border-gray-300 bg-white p-3 text-sm text-gray-800"
                            />
                            <div className="mt-2 flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={!newComment.trim()}
                                    onClick={() => {
                                        setDraftManagerComment(
                                            prependComment(draftManagerComment, newComment, commentAuthor),
                                        );
                                        setNewComment('');
                                        setDirty(true);
                                    }}
                                    className="bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:bg-gray-300"
                                >
                                    Добавить запись
                                </button>
                                <span className="text-[11px] text-gray-500">
                                    Дату, время и фамилию подставит система — писать их не нужно
                                </span>
                            </div>
                            <textarea
                                value={draftManagerComment}
                                onChange={(e) => { setDraftManagerComment(e.target.value); setDirty(true); }}
                                rows={6}
                                placeholder="Договорённости, обещания, что делать дальше"
                                className="mt-3 w-full border border-gray-200 bg-white p-3 text-sm text-gray-800"
                            />
                        </div>
                        {/* Советы бота-РОПа — своим окном рядом (решение владельца
                            05.10.2026). Раньше они дописывались в комментарий
                            менеджера и перемешивались с его договорённостями. */}
                        <div className="bg-white border border-gray-200 p-4">
                            <h4 className="mb-3 text-sm font-semibold text-gray-900">Заметки бота-РОПа</h4>
                            {(data.ropNotes?.length ?? 0) > 0 ? (
                                <div className="max-h-44 space-y-2 overflow-auto">
                                    {(data.ropNotes ?? []).map((note: any, i: number) => (
                                        <div key={i} className="border border-gray-100 bg-gray-50 p-2">
                                            <div className="text-[11px] uppercase tracking-wide text-gray-500">
                                                {note.date ? new Date(note.date).toLocaleDateString('ru-RU') : '—'}
                                            </div>
                                            <div className="text-sm text-gray-800">{note.text}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">
                                    Бот по этому заказу пока ничего не советовал.
                                </p>
                            )}
                        </div>
                    </div>
                </section>

                <section id="order-delivery" className="space-y-3">
                    {/* Складских полей здесь нет: склада у компании нет, всё идёт
                        прямо с производства (решение владельца 30.09.2026). */}
                    <CardSection id="order-shipping" title="Отгрузка и доставка">
                        {/* Срок и единица — в одну строку и узкими: вносят туда
                            мало, а занимали полблока (решение владельца
                            06.10.2026). «Дата отгрузки» убрана — её не
                            заполняет ничто, пусто у всех 1830 заказов за
                            полгода, и такого поля нет в справочнике RetailCRM. */}
                        <div className="flex flex-wrap items-start gap-2">
                            <div className="w-36">
                                <EditField fieldKey="cf.srok_izgot" label="Срок изготовления, дней" type="number" value={fieldValue('cf.srok_izgot', customFields.srok_izgot ?? '')} onChange={(v) => setField('cf.srok_izgot', v)} />
                            </div>
                            {/* Какие это дни — «80» само по себе читается двояко
                                (замечание Евгении 05.10.2026). Единица идёт в КП,
                                счёт и договор. */}
                            <div className="w-44">
                                <EditField fieldKey="order.srok_izgot_edinica"
                                    label="Дни считаем"
                                    value={fieldValue('order.srok_izgot_edinica', order?.srok_izgot_edinica || 'kalendarnye')}
                                    onChange={(v) => setField('order.srok_izgot_edinica', v)}
                                    options={[
                                        { value: 'kalendarnye', label: 'Календарные' },
                                        { value: 'rabochie', label: 'Рабочие' },
                                    ]}
                                />
                            </div>
                        </div>
                        {/* Логисту пишут длинным текстом — поле в несколько строк,
                            как комментарий оператору (решение владельца 06.10.2026).
                            Сюда же слито «Примечание по отгрузке»: это было о том
                            же самом, и менеджеры не знали, какое из двух полей
                            заполнять. Заполненное перенесено, 15 заказов. */}
                        <div className="mt-2">
                            <EditField fieldKey="cf.komment_diveleri"
                                label="Комментарий логисту"
                                multiline
                                value={fieldValue('cf.komment_diveleri', customFields.komment_diveleri || '')}
                                onChange={(v) => setField('cf.komment_diveleri', v)}
                            />
                        </div>
                    </CardSection>

                    <CardSection id="order-delivery" title="Доставка">
                        <div className="grid md:grid-cols-2 gap-2">
                            <EditField fieldKey="delivery.code"
                                label="Тип доставки"
                                value={fieldValue('delivery.code', delivery.code || delivery.type || '')}
                                options={names.enumOptions('deliveryType')}
                                onChange={(v) => setField('delivery.code', v)}
                            />
                            {/* Дата, время и стоимость доставки убраны из карточки
                                08.10.2026 по просьбе менеджеров: их никто не
                                заполняет. Замер на боевой базе — дата стоит у 3
                                заказов из 30 207, стоимость у 24, время ни у
                                одного; за последние 90 дней — ни одного по всем
                                трём. Данные в базе не трогали: если поле снова
                                понадобится, вернуть его — одна строка. */}
                            <EditField fieldKey="delivery.region" label="Регион" value={fieldValue('delivery.region', logisticRegion || '')} onChange={(v) => setField('delivery.region', v)} />
                            <EditField fieldKey="delivery.city" label="Город" value={fieldValue('delivery.city', logisticCity || '')} onChange={(v) => setField('delivery.city', v)} />
                            {/* Отдельное поле RetailCRM, его заполняет менеджер ОП:
                                в заявке город известен раньше адреса доставки. В
                                карточке ОКК его не было — просьба менеджеров
                                07.10.2026. Подпись берём из каталога полей CRM. */}
                            <EditField
                                fieldKey="cf.gorod_dostavki_menedzheram_op"
                                label={names.fieldLabel('gorod_dostavki_menedzheram_op', 'Город доставки (менеджерам ОП)')}
                                value={fieldValue('cf.gorod_dostavki_menedzheram_op', deliveryCityManager || '')}
                                onChange={(v) => setField('cf.gorod_dostavki_menedzheram_op', v)}
                            />
                            <EditField fieldKey="delivery.index" label="Индекс" value={fieldValue('delivery.index', logisticIndex || '')} onChange={(v) => setField('delivery.index', v)} />
                            <EditField fieldKey="cf.consignee" label="Получатель" value={fieldValue('cf.consignee', customFields.consignee || logisticReceiver || '')} onChange={(v) => setField('cf.consignee', v)} />
                        </div>

                        {/* Адрес одной строкой и разбор по частям — как в RetailCRM:
                            менеджер вставляет скопированный адрес, а область, город
                            и индекс система ставит сама (просьба Лены Парфёновой
                            05.10.2026). */}
                        <div className="mt-2">
                            <EditField
                                fieldKey="delivery.address"
                                label="Адрес доставки"
                                value={fieldValue('delivery.address', logisticAddress || '')}
                                onChange={(v) => setField('delivery.address', v)}
                            />
                            <div className="mt-1 flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={parsingAddress}
                                    onClick={async () => {
                                        const address = String(fieldValue('delivery.address', logisticAddress || '') ?? '').trim();
                                        if (!address) return;
                                        setParsingAddress(true);
                                        setAddressNote(null);
                                        try {
                                            const res = await fetch('/api/address/parse', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ address }),
                                            });
                                            const payload = await res.json();
                                            if (!res.ok) throw new Error(payload.error || 'Адрес не разобрался');
                                            const parts = payload.parts ?? {};
                                            setDraftFields((prev) => ({
                                                ...prev,
                                                ...(parts.address ? { 'delivery.address': parts.address } : {}),
                                                ...(parts.region ? { 'delivery.region': parts.region } : {}),
                                                ...(parts.city ? { 'delivery.city': parts.city } : {}),
                                                ...(parts.index ? { 'delivery.index': parts.index } : {}),
                                            }));
                                            setDirty(true);
                                            setAddressNote('Разобрали: проверьте части и сохраните');
                                        } catch (e: any) {
                                            setAddressNote(e.message);
                                        } finally {
                                            setParsingAddress(false);
                                        }
                                    }}
                                    className="border border-blue-600 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400"
                                >
                                    {parsingAddress ? 'Разбираем…' : 'Разобрать по полям'}
                                </button>
                                <span className="text-[11px] text-gray-500">
                                    {addressNote || 'Вставьте адрес целиком — область, город и индекс заполнятся сами'}
                                </span>
                            </div>
                        </div>

                    </CardSection>

                    <div className="bg-white border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-xs uppercase text-gray-400">Коммуникации</p>
                                <h4 className="text-lg font-semibold text-gray-900">Письма и сообщения</h4>
                            </div>
                            <button
                                onClick={() => setReplyOpen((v) => !v)}
                                className="px-3 py-2 text-sm font-medium border border-blue-600 text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                                {replyOpen ? 'Свернуть' : '+ Новое письмо'}
                            </button>
                        </div>

                        {/* Письмо пишется в отдельном окне поверх карточки: так менеджер
                            видит только письмо и не теряет место в заказе. */}
                        {replyOpen && (
                            <div
                                className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-6"
                                onClick={() => setReplyOpen(false)}
                            >
                                <div
                                    className="w-full max-w-3xl bg-white p-4 shadow-none"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="mb-3 flex items-center justify-between border-b border-gray-200 pb-2">
                                        <h3 className="text-lg font-semibold text-gray-900">
                                            Письмо по заказу №{String(data.order?.number ?? orderId)}
                                        </h3>
                                        <button
                                            onClick={() => setReplyOpen(false)}
                                            className="px-2 text-xl leading-none text-gray-400 hover:text-gray-900"
                                            title="Закрыть"
                                        >
                                            ×
                                        </button>
                                    </div>
                                    <OrderReplyForm
                                        orderNumber={String(data.order?.number ?? orderId)}
                                        replyTo={replySource}
                                        onClose={() => { setReplyOpen(false); setReplySource(null); }}
                                    />
                                </div>
                            </div>
                        )}
                        {contractOpen && (
                            <div
                                className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-6"
                                onClick={() => setContractOpen(false)}
                            >
                                <div className="w-full max-w-2xl bg-white p-4 shadow-none" onClick={(e) => e.stopPropagation()}>
                                    <div className="mb-3 flex items-center justify-between border-b border-gray-200 pb-2">
                                        <h3 className="text-lg font-semibold text-gray-900">
                                            Договор по заказу №{String(data.order?.number ?? orderId)}
                                        </h3>
                                        <button
                                            onClick={() => setContractOpen(false)}
                                            className="px-2 text-xl leading-none text-gray-400 hover:text-gray-900"
                                            title="Закрыть"
                                        >
                                            ×
                                        </button>
                                    </div>
                                    {/* Стандартные условия списком: те же, по которым
                                        отдел продаж работал в RetailCRM. Такой договор
                                        юристу не нужен — это согласованная редакция
                                        (решение владельца 07.10.2026). */}
                                    <p className="mb-2 text-sm text-gray-600">
                                        Выберите условия оплаты — договор составится сразу, без юриста.
                                        Реквизиты, предмет и сроки изготовления подставятся из заказа.
                                    </p>
                                    <select
                                        value={contractTermCode}
                                        onChange={(e) => {
                                            setContractTermCode(e.target.value);
                                            if (e.target.value) setContractTerms('');
                                        }}
                                        className="mb-3 w-full border border-gray-300 px-2 py-2 text-sm"
                                    >
                                        <option value="">Свои условия — напишу сам</option>
                                        {STANDARD_CONTRACT_TERMS.map((term) => (
                                            <option key={term.code} value={term.code}>{term.label}</option>
                                        ))}
                                    </select>

                                    {!contractTermCode && (
                                        <>
                                            <p className="mb-2 text-sm text-gray-600">
                                                Напишите условия своими словами — например «70 предоплата, 30 перед
                                                отгрузкой». Такой договор уйдёт юристу на согласование.
                                            </p>
                                            <textarea
                                                value={contractTerms}
                                                onChange={(e) => setContractTerms(e.target.value)}
                                                rows={5}
                                                placeholder="70 предоплата в течение 5 банковских дней, 30 перед отгрузкой"
                                                className="w-full border border-gray-200 px-3 py-2 text-sm"
                                            />
                                        </>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button
                                            disabled={contractSaving || (!contractTermCode && !contractTerms.trim())}
                                            onClick={async () => {
                                                setContractSaving(true);
                                                setContractNote(null);
                                                try {
                                                    const res = await fetch(`/api/orders/${encodeURIComponent(String(data.order?.number ?? orderId))}/contract`, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            terms: contractTerms.trim() || 'стандартные условия',
                                                            termCode: contractTermCode || null,
                                                            seller: sellerCode || null,
                                                            orderId: Number(orderId),
                                                        }),
                                                    });
                                                    const payload = await res.json();
                                                    if (!res.ok) throw new Error(payload.error || 'Договор не составился');
                                                    setContractNote(payload.note || 'Договор отправлен юристу.');
                                                    setContractReview(payload.review ?? null);
                                                    setContractId(payload.id ?? null);
                                                    setContractTerms('');
                                                } catch (e: any) {
                                                    setContractNote(e.message);
                                                } finally {
                                                    setContractSaving(false);
                                                }
                                            }}
                                            className="bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                                        >
                                            {contractSaving
                                                ? 'Составляю…'
                                                : contractTermCode ? 'Составить договор' : 'Составить и отправить юристу'}
                                        </button>
                                        {/* Стандартный договор обычно юристу не нужен, но
                                            иногда клиент просит проверить — тогда этой
                                            кнопкой (решение владельца 07.10.2026). */}
                                        {contractTermCode && (
                                            <button
                                                disabled={contractSaving}
                                                onClick={async () => {
                                                    setContractSaving(true);
                                                    setContractNote(null);
                                                    try {
                                                        const term = STANDARD_CONTRACT_TERMS.find((t) => t.code === contractTermCode);
                                                        const res = await fetch(`/api/orders/${encodeURIComponent(String(data.order?.number ?? orderId))}/contract`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                terms: term?.text || 'стандартные условия',
                                                                seller: sellerCode || null,
                                                                orderId: Number(orderId),
                                                            }),
                                                        });
                                                        const payload = await res.json();
                                                        if (!res.ok) throw new Error(payload.error || 'Договор не составился');
                                                        setContractNote(payload.note || 'Договор отправлен юристу.');
                                                        setContractReview(payload.review ?? null);
                                                    } catch (e: any) {
                                                        setContractNote(e.message);
                                                    } finally {
                                                        setContractSaving(false);
                                                    }
                                                }}
                                                className="border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-50"
                                            >
                                                Отправить на согласование юристу
                                            </button>
                                        )}
                                        {contractNote && <span className="text-sm text-gray-700">{contractNote}</span>}
                                        {/* Сам документ: без ссылки менеджер видел только
                                            замечания ИИ и спрашивал, где взять файл
                                            (08.10.2026). Файл с подписью и печатью лежит
                                            и во вкладке «Файлы» этого заказа. */}
                                        {contractId && (
                                            <button
                                                type="button"
                                                disabled={documentBusy !== null}
                                                onClick={() => openOrderDocument('contract', `/api/orders/${encodeURIComponent(String(data.order?.number ?? orderId))}/contract/file?id=${contractId}`)}
                                                className="text-sm font-semibold text-blue-700 hover:underline disabled:text-gray-400"
                                            >
                                                {documentBusy === 'contract' ? 'Открываем договор…' : 'Открыть договор (PDF)'}
                                            </button>
                                        )}
                                        {/* Комплект как в RetailCRM: счёт, договор и
                                            спецификация одним файлом (эталон — заказ
                                            54729). Файл ложится в «Файлы» заказа, и
                                            его можно приложить к письму галочкой. */}
                                        {contractId && (
                                            <button
                                                type="button"
                                                disabled={documentBusy !== null}
                                                onClick={() => openOrderDocument('kit', `/api/orders/${encodeURIComponent(String(data.order?.number ?? orderId))}/contract/kit?id=${contractId}`)}
                                                className="text-sm font-semibold text-blue-700 hover:underline disabled:text-gray-400"
                                            >
                                                {documentBusy === 'kit'
                                                    ? 'Собираем комплект, 5–10 секунд…'
                                                    : 'Счёт + договор + спецификация (PDF)'}
                                            </button>
                                        )}
                                        {documentNote && (
                                            <span className="text-sm text-gray-600">{documentNote}</span>
                                        )}
                                    </div>

                                    {/* Замечания ИИ-юрисконсульта (Лев) — к каждому
                                        договору (требование владельца 07.10.2026).
                                        Это подсказка, а не запрет: договор уже
                                        составлен, решение за менеджером. */}
                                    {contractReview && (
                                        <div
                                            className={`mt-3 border p-3 text-sm ${
                                                contractReview.level === 'risk'
                                                    ? 'border-red-300 bg-red-50'
                                                    : contractReview.level === 'ok'
                                                        ? 'border-green-300 bg-green-50'
                                                        : 'border-amber-300 bg-amber-50'
                                            }`}
                                        >
                                            <div className="mb-1 flex items-baseline justify-between gap-2">
                                                <span className="font-semibold text-gray-900">
                                                    Комментарий ИИ-юриста
                                                </span>
                                                <span className="text-[11px] uppercase tracking-wide text-gray-500">
                                                    {contractReview.level === 'risk'
                                                        ? 'лучше показать юристу'
                                                        : contractReview.level === 'ok'
                                                            ? 'можно отправлять'
                                                            : 'стоит глянуть'}
                                                </span>
                                            </div>
                                            <p className="text-gray-800">{contractReview.summary}</p>
                                            {contractReview.notes.length > 0 && (
                                                <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-800">
                                                    {contractReview.notes.map((note, i) => (
                                                        <li key={i}>{note}</li>
                                                    ))}
                                                </ul>
                                            )}
                                            {!contractReview.byAi && (
                                                <p className="mt-2 text-[11px] text-gray-500">
                                                    Договор не проверен — ИИ-юрисконсульт был недоступен.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {/* Письма, которые отправляла и получала сама RetailCRM
                            (её модуль «Коммуникации»), через API недоступны —
                            в 191 методе их нет. Поэтому даём прямую ссылку на
                            карточку заказа там (02.10.2026). */}
                        {!isOwn && crmOrderUrl && (
                            <p className="mb-3 text-xs text-gray-600">
                                Письма, которые отправляла сама RetailCRM, остались у неё:{' '}
                                <a href={crmOrderUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                                    открыть коммуникации заказа в RetailCRM
                                </a>
                            </p>
                        )}
                        {data.emails && data.emails.length > 0 ? (
                            <div className="space-y-3">
                                {data.emails.map((email) => {
                                    const key = String(email.id || email.date);
                                    const open = openedEmails.has(key);

                                    return (
                                        <div key={key} className="border border-gray-200 p-4 bg-white">
                                            <div className="flex items-center justify-between gap-2 text-xs text-gray-500 mb-2">
                                                <span>{email.date ? new Date(email.date).toLocaleString('ru-RU') : 'Без даты'}</span>
                                                {/* Значок направления: сразу видно, письмо нам или от нас. */}
                                                <span
                                                    className={`flex items-center gap-1.5 px-2 py-0.5 font-semibold ${
                                                        email.source === 'incoming'
                                                            ? 'bg-green-50 text-green-800'
                                                            : email.source === 'outgoing'
                                                                ? 'bg-blue-50 text-blue-800'
                                                                : 'bg-gray-100'
                                                    }`}
                                                >
                                                    {email.source === 'incoming' && <span aria-hidden>↓</span>}
                                                    {email.source === 'outgoing' && <span aria-hidden>↑</span>}
                                                    {email.type}
                                                    {email.party ? ` · ${email.party}` : ''}
                                                </span>
                                            </div>
                                            {/* «Ответить» и в шапке письма: до него не надо
                                                разворачивать письмо и листать до конца
                                                (просьба владельца 05.10.2026). */}
                                            <div className="mb-2 flex justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setReplySource({
                                                            to: email.partyEmail || email.party || null,
                                                            subject: email.subject || null,
                                                            quote: email.body ? String(email.body).slice(0, 4000) : null,
                                                        });
                                                        setReplyOpen(true);
                                                    }}
                                                    className="border border-blue-600 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                                >
                                                    Ответить
                                                </button>
                                            </div>

                                            {/* Письмо открывается целиком: до этого была видна одна
                                                тема, и внутрь попасть было нельзя (замечание Евгении
                                                02.10.2026). */}
                                            <button
                                                type="button"
                                                onClick={() => setOpenedEmails((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(key)) next.delete(key); else next.add(key);
                                                    return next;
                                                })}
                                                className="block w-full text-left"
                                            >
                                                <p className="text-sm font-semibold text-gray-900">
                                                    <TextWithOrderLinks text={email.subject || 'Без темы'} />
                                                </p>
                                                {!open && (
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        {email.body
                                                            ? `${String(email.body).slice(0, 160)}${String(email.body).length > 160 ? '…' : ''}`
                                                            : 'Текст письма не сохранён'}
                                                        <span className="ml-2 font-semibold text-blue-700">открыть</span>
                                                    </p>
                                                )}
                                            </button>

                                            {open && (
                                                <div className="mt-2 border-t border-gray-100 pt-2">
                                                    <p className="whitespace-pre-line text-sm text-gray-800">
                                                        <TextWithOrderLinks text={email.body || 'Текст этого письма у нас не сохранён — в ленте есть только факт отправки.'} />
                                                    </p>
                                                    {/* Вложения письма: PDF и картинки открываются
                                                        всплывающим окном, остальное скачивается
                                                        (решение владельца 05.10.2026). */}
                                                    {email.attachmentList?.length ? (
                                                        <div className="mt-2">
                                                            <AttachmentList
                                                                files={email.attachmentList}
                                                                href={email.emailId
                                                                    ? (name: string) => `/api/orders/${encodeURIComponent(String(data.order?.number ?? orderId))}/files/download?emailId=${encodeURIComponent(email.emailId)}&filename=${encodeURIComponent(name)}`
                                                                    : null}
                                                            />
                                                        </div>
                                                    ) : email.attachments > 0 ? (
                                                        <p className="mt-2 text-xs text-gray-500">
                                                            Вложений: {email.attachments} — они в разделе «Файлы» заказа.
                                                        </p>
                                                    ) : null}
                                                    <div className="mt-2 flex items-center gap-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setOpenedEmails((prev) => {
                                                                const next = new Set(prev);
                                                                next.delete(key);
                                                                return next;
                                                            })}
                                                            className="text-xs font-semibold text-gray-500 hover:underline"
                                                        >
                                                            свернуть
                                                        </button>
                                                        {/* Ответ прямо отсюда: адрес, тему и цитату
                                                            письма подставляем сами (просьба Жени
                                                            Матвеевой 05.10.2026). */}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setReplySource({
                                                                    to: email.partyEmail || email.party || null,
                                                                    subject: email.subject || null,
                                                                    quote: email.body ? String(email.body).slice(0, 4000) : null,
                                                                });
                                                                setReplyOpen(true);
                                                            }}
                                                            className="border border-blue-600 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                                        >
                                                            Ответить
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">
                                Писем по заказу ещё нет. Здесь появятся входящие письма, которые
                                разобрала почта, и письма, отправленные из этой карточки.
                            </p>
                        )}
                    </div>
                </section>

                <section id="order-payment" className="space-y-3">
                    <div className="bg-white border border-gray-200 p-4">
                        <h3 className="text-base font-semibold text-gray-900 mb-2">Оплата</h3>
                        <div className="grid md:grid-cols-3 gap-2">
                            <InfoField label="Предоплата" value={formatCurrency(toNumber(order.prepaySum))} />
                            <InfoField label="Ожидается" value={formatCurrency(toNumber(order.purchaseSumm))} />
                        </div>
                    </div>

                    {/* Свой заказ: оплаты ведём у себя — в RetailCRM этого заказа нет. */}
                    {order.is_own && <OwnOrderPayments orderId={Number(order.id)} />}

                    {paymentsSummary.length > 0 && (
                        <div className="bg-white border border-gray-200 p-4">
                            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Оплаты в CRM</h4>
                            <div className="space-y-3">
                                {paymentsSummary.map((payment: any) => (
                                    <div key={payment.id || payment.type} className="border border-gray-100 p-4 flex flex-col gap-1 bg-gray-50">
                                        <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                                            <span>{payment.type || 'Оплата'}</span>
                                            <span>{formatCurrency(payment.amount)}</span>
                                        </div>
                                        {payment.date && <span className="text-xs text-gray-500">Дата: {formatDate(payment.date)}</span>}
                                        {payment.status && <span className="text-xs text-gray-500">Статус: {payment.status}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>


            </div>
        );
    };

    const handleSectionNavClick = (sectionId: string) => {
        const target = document.getElementById(sectionId);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    /**
     * Технические данные: то, что по заказу хранится, но менеджеру в работе не
     * нужно (требование владельца 02.10.2026 — три поля: документооборот через
     * ЭДО, счёт действителен, Roistat). Экран менеджера от них свободен, но
     * данные не спрятаны: открыть можно одной вкладкой.
     */
    /** Содержимое вкладки «Для производства» — одним запросом. */
    /**
     * Приложить файл прямо отсюда.
     *
     * Евгения Матвеева 09.10.2026: «заказ оплачен, заказчики меняют габариты,
     * отправила новое КП — в комментариях производству новые файлы не
     * подтягиваются. Можно сделать кнопку, чтобы файл с компа самому
     * приложить?». Раньше за этим приходилось уходить во вкладку «Файлы» и
     * возвращаться. Тип файла не ограничиваем: цеху возят и чертежи, и
     * фотографии, и архивы.
     */
    const uploadProductionFile = async (file: File) => {
        setProductionUploading(true);
        setProductionMessage(null);
        try {
            const body = new FormData();
            body.append('file', file);
            const res = await fetch(`/api/orders/${encodeURIComponent(String(data?.order?.number ?? orderId))}/files/upload`, {
                method: 'POST',
                body,
            });
            const payload = await res.json().catch(() => null);
            if (!res.ok) throw new Error(payload?.error || 'Файл не загрузился');

            // Файл для цеха — сразу отмечаем: за этим его и прикладывают.
            if (payload?.file?.id) await toggleProductionFile(Number(payload.file.id), true);
            await loadProduction();
            setProductionMessage(`Файл «${file.name}» приложен и отмечен для цеха`);
        } catch (e: any) {
            setProductionMessage(e.message || 'Файл не загрузился');
        } finally {
            setProductionUploading(false);
        }
    };

    const loadProduction = useCallback(async () => {
        const orderNumber = String(data?.order?.number ?? orderId);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/production`);
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось прочитать данные для производства');
            setProductionData(payload);
            setProductionNote(payload.comment || '');
            setProductionMessage(null);
        } catch (e: any) {
            setProductionMessage(e.message);
        }
    }, [data?.order?.number, orderId]);

// Содержимое вкладки «Для производства» читаем при переходе на неё, а не
    // при каждом открытии карточки: на основном экране оно не нужно.
    useEffect(() => {
        if (isOpen && viewTab === 'production' && !productionData) void loadProduction();
    }, [isOpen, viewTab, productionData, loadProduction]);

    const saveProductionNote = async () => {
        const orderNumber = String(data?.order?.number ?? orderId);
        setProductionSaving(true);
        setProductionMessage(null);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/production`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comment: productionNote }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Не удалось сохранить');
            setProductionMessage('Сохранено');
            await loadProduction();
        } catch (e: any) {
            setProductionMessage(e.message);
        } finally {
            setProductionSaving(false);
        }
    };

    /** Отметка файла уходит сразу: терять её в несохранённой форме обиднее, чем текст. */
    const toggleProductionFile = async (fileId: number, on: boolean) => {
        setProductionData((current) => current && ({
            ...current,
            files: current.files.map((file) => (file.id === fileId ? { ...file, forProduction: on } : file)),
        }));
        try {
            const orderNumber = String(data?.order?.number ?? orderId);
            const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/production`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId, forProduction: on }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || 'Отметка не сохранилась');
            }
        } catch (e: any) {
            setProductionMessage(e.message);
            await loadProduction();
        }
    };

    /**
     * Вкладка «Для производства».
     *
     * Сюда менеджер пишет то, что нужно цеху, и отмечает файлы заказа, которые
     * уходят вместе с ним. Комментарий менеджера в производство больше не
     * передаётся: в нём договорённости по цене и заметки про конкурентов
     * (решение владельца 04.10.2026).
     */
    const renderProductionView = () => {
        const orderNumber = String(data?.order?.number ?? orderId);
        const files = productionData?.files ?? [];

        return (
            <div className="space-y-4 p-4">
                <div className="bg-white border border-gray-200 p-4">
                    <h4 className="text-sm font-semibold text-gray-900">Комментарий для производства</h4>
                    <p className="mt-1 text-xs text-gray-500">
                        Что важно знать цеху по этому заказу. Этот текст уходит в ЦехУспех —
                        комментарий менеджера туда не передаётся.
                    </p>
                    <textarea
                        value={productionNote}
                        onChange={(event) => setProductionNote(event.target.value)}
                        rows={6}
                        placeholder="Например: покрытие по образцу заказчика, отгрузка одной партией"
                        className="mt-3 w-full border border-gray-200 bg-white p-3 text-sm text-gray-800"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            disabled={productionSaving}
                            onClick={saveProductionNote}
                            className="bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {productionSaving ? 'Сохраняю…' : 'Сохранить'}
                        </button>
                        {productionData?.updatedBy && (
                            <span className="text-xs text-gray-500">
                                Последняя правка: {productionData.updatedBy}
                                {productionData.updatedAt ? ` · ${new Date(productionData.updatedAt).toLocaleString('ru-RU')}` : ''}
                            </span>
                        )}
                        {productionMessage && <span className="text-xs text-gray-700">{productionMessage}</span>}
                    </div>
                </div>

                <div className="bg-white border border-gray-200 p-4">
                    <h4 className="text-sm font-semibold text-gray-900">Файлы для производства</h4>
                    <p className="mt-1 text-xs text-gray-500">
                        Отметьте техническое задание и чертежи, которые нужны цеху. Отмеченные файлы
                        уходят вместе с заказом; остальные остаются только у нас.
                    </p>

                    <label className={`mt-3 inline-block cursor-pointer border px-3 py-2 text-sm font-semibold ${
                        productionUploading
                            ? 'border-gray-200 text-gray-400'
                            : 'border-blue-600 text-blue-700 hover:bg-blue-50'
                    }`}>
                        {productionUploading ? 'Загружаю…' : 'Приложить файл'}
                        <input
                            type="file"
                            className="hidden"
                            disabled={productionUploading}
                            onChange={(event) => {
                                const picked = event.target.files?.[0];
                                event.target.value = '';
                                if (picked) void uploadProductionFile(picked);
                            }}
                        />
                    </label>

                    {files.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">
                            Файлов по этому заказу нет — приложите кнопкой выше или во вкладке «Файлы».
                        </p>
                    ) : (
                        /* Список не прячем под короткую прокрутку: файлов по
                           заказу бывает дюжина, и человек должен видеть, что
                           отмечено, целиком. */
                        <div className="mt-3 max-h-[420px] overflow-y-auto divide-y divide-gray-100 border border-gray-200">
                            {files.map((file) => (
                                <label key={file.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                                    <input
                                        type="checkbox"
                                        checked={file.forProduction}
                                        onChange={(event) => toggleProductionFile(file.id, event.target.checked)}
                                        className="h-4 w-4"
                                    />
                                    <span className="flex-1 truncate text-sm text-gray-800">{file.fileName}</span>
                                    <a
                                        href={`/api/orders/${encodeURIComponent(orderNumber)}/files/download?fileId=${file.id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(event) => event.stopPropagation()}
                                        className="shrink-0 text-xs font-semibold text-blue-700 hover:underline"
                                    >
                                        открыть
                                    </a>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderTechView = () => {
        const json = data as any;
        const payload = json?.raw_payload ?? {};
        const customFields = payload.customFields ?? {};

        const order = json?.order ?? {};
        const contact = payload.contact ?? {};
        const customer = payload.customer ?? {};
        const createdDate = formatDateTime(order.created_at);
        const statusUpdated = formatDateTime(pickValue(payload.statusUpdatedAt, order.updated_at));
        const privilegeType = pickValue(order.privilegeType);
        const documentsViaEDO = formatBooleanYesNo(customFields.dokumentooborot_cherez_edo);
        const invoiceValidDays = pickValue(customFields.schiot_deistvitelen_v_techenie_dnei);
        const selfCost = toNumber(pickValue(payload.delivery?.selfCost, customFields.sebestoimost2));

        return (
            <div className="bg-white border border-gray-200 p-4">
                <div className="grid md:grid-cols-2 gap-2">
                    {/* Справочники — выпадающими списками, как в RetailCRM:
                        значения тянем из синканутого каталога. */}
                    <EditField fieldKey="orderMethod"
                        label="Способ оформления"
                        value={fieldValue('orderMethod', order.orderMethod || '')}
                        options={names.enumOptions('orderMethod')}
                        onChange={(v) => setField('orderMethod', v)}
                    />
                    <InfoField label="VIP" value={formatBooleanYesNo(contact.vip || customer.vip)} />
                    <InfoField label="BAD" value={formatBooleanYesNo(contact.bad || customer.bad)} />
                    <InfoField label="Дата поступления" value={createdDate} />
                    <InfoField label="Обновлён" value={statusUpdated} />
                    <InfoField label="Привилегия" value={privilegeType || '—'} />
                    <InfoField label="Документооборот через ЭДО" value={documentsViaEDO} />
                    <InfoField label="Счёт действителен (дней)" value={invoiceValidDays || '—'} />
                    {/* Перенесено с рабочего экрана по решению владельца
                        06.10.2026. Поля настоящие, но в работе не нужны: маржа
                        заполнена у 20 заказов из 1831, себестоимость — у 278, а
                        статус и дата оплаты, диалоги и партнёр не приходят из
                        RetailCRM ни по одному заказу (настоящие оплаты показаны
                        списком в блоке «Оплата»). */}
                    <EditField fieldKey="cf.marzha"
                        label="Маржа, %"
                        value={fieldValue('cf.marzha', customFields.marzha || '')}
                        onChange={(v) => setField('cf.marzha', v)}
                    />
                    <InfoField label="Себестоимость" value={formatCurrency(selfCost)} />
                    <InfoField label="Статус оплаты" value={names.resolve('paymentStatus', payload.payment?.status) || 'Не указан'} />
                    <InfoField label="Дата оплаты" value={formatDate(payload.payment?.date)} />
                    <InfoField label="Комментарий к оплате" value={payload.payment?.comment || '—'} />
                    <InfoField label="Диалоги" value={payload.dialogsCount ? `${payload.dialogsCount} открыто` : 'Нет открытых диалогов'} />
                    <InfoField label="Партнёр" value={customer.partner || '—'} />
                    {/* Тип клиента — в технические по решению владельца
                        06.10.2026: «у нас всегда один тип». Заказы на физлицо
                        всё же встречаются (79 из 1831 за полгода), поэтому поле
                        не удалено — его видно здесь. */}
                    <InfoField label="Тип клиента" value={customer.type === 'customer_corporate' ? 'Юридическое лицо' : 'Клиент'} />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                    Здесь то, что в работе с заказом не нужно: служебные пометки и метка рекламной
                    системы. Если какое-то из этих полей понадобится в работе — скажите, вернём на
                    основной экран.
                </p>
            </div>
        );
    };

    const renderQualityView = () => {
        if (!data) return null;

        const activeCall = qualityCalls[selectedCallIndex] || null;
        const primaryClientNumber = activeCall
            ? activeCall.direction === 'incoming'
                ? (activeCall.from_number || activeCall.from_number_normalized)
                : (activeCall.to_number || activeCall.to_number_normalized)
            : null;
        const secondaryClientNumber = activeCall
            ? activeCall.direction === 'incoming'
                ? (activeCall.to_number || activeCall.to_number_normalized)
                : (activeCall.from_number || activeCall.from_number_normalized)
            : null;
        const callNumbers = activeCall
            ? Array.from(new Set([primaryClientNumber, secondaryClientNumber].filter((num): num is string => Boolean(num))))
            : [];
        const managerIdString = typeof data.order?.manager_id === 'number'
            ? String(data.order.manager_id)
            : (typeof qualityScore?.manager_id === 'number' ? String(qualityScore.manager_id) : null);
        const orderIdString = String(orderId);
        const breakdown = qualityScore?.score_breakdown as Record<string, ScoreBreakdownEntry> | undefined;
        const scoreBreakdownEntries = breakdown
            ? Object.entries(breakdown).filter(([, info]) => info && info.reason)
            : [];
        const isInitialLoading = !qualityFetched && (qualityCallsLoading || qualityScoreLoading);

        return (
            <section className="bg-white border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 border-b bg-white flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-xs uppercase text-gray-400">ОКК · Контроль качества</p>
                        <h3 className="text-2xl font-semibold text-gray-900">Звонки и анализ #{orderId}</h3>
                        <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                            <span>Менеджер: <strong className="text-gray-900">{qualityScore?.manager_name || data.order?.manager_name || '—'}</strong></span>
                            <span className="flex items-center gap-2">
                                Статус:
                                <span
                                    className="px-2 py-0.5 text-xs font-semibold"
                                    style={{ backgroundColor: qualityScore?.status_color || '#E0E7FF', color: '#111827' }}
                                >
                                    {qualityScore?.status_label || data.order?.status || '—'}
                                </span>
                            </span>
                            <span>Сумма: <strong>{formatCurrency(qualityScore?.total_sum || data.order?.totalsumm)}</strong></span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleQualityRefresh}
                            disabled={qualityCallsLoading || qualityScoreLoading}
                            className="px-4 py-2 border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            ↻ Обновить
                        </button>
                    </div>
                </div>

                {qualityError && (
                    <div className="px-6 py-3 bg-red-50 text-red-600 text-sm border-b border-red-100">{qualityError}</div>
                )}

                {isInitialLoading ? (
                    <div className="flex items-center justify-center py-16 bg-slate-50">
                        <div className="animate-spin h-12 w-12 border-b-2 border-blue-600"></div>
                    </div>
                ) : (
                    <div className="flex flex-col min-h-[560px] bg-slate-50/60">
                        <div className="flex md:hidden border-b bg-white text-[10px] font-black uppercase tracking-widest text-gray-500">
                            <button
                                onClick={() => setQualityMobileTab('calls')}
                                className={`flex-1 py-3 text-center border-b-2 ${qualityMobileTab === 'calls' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                            >
                                Звонки
                            </button>
                            <button
                                onClick={() => setQualityMobileTab('transcript')}
                                className={`flex-1 py-3 text-center border-b-2 ${qualityMobileTab === 'transcript' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                            >
                                Текст
                            </button>
                            <button
                                onClick={() => setQualityMobileTab('analysis')}
                                className={`flex-1 py-3 text-center border-b-2 ${qualityMobileTab === 'analysis' ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent'}`}
                            >
                                Анализ
                            </button>
                        </div>

                        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
                            <aside className={`${qualityMobileTab === 'calls' ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r bg-gray-50/60 overflow-y-auto flex-col`}>
                                <div className="p-3 border-b bg-white/70 sticky top-0">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">История разговоров</h4>
                                </div>
                                {qualityCallsLoading && qualityCalls.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center py-12">
                                        <div className="animate-spin h-6 w-6 border-b-2 border-blue-600"></div>
                                    </div>
                                ) : qualityCalls.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-xs italic">Звонки ещё не привязаны к заказу</div>
                                ) : (
                                    <div className="divide-y divide-gray-100">
                                        {qualityCalls.map((call, idx) => (
                                            <button
                                                key={`${call.telphin_call_id || call.started_at || idx}`}
                                                onClick={() => {
                                                    setSelectedCallIndex(idx);
                                                    if (qualityMobileTab !== 'calls') {
                                                        setQualityMobileTab('transcript');
                                                    }
                                                }}
                                                className={`w-full text-left p-3 md:p-4 hover:bg-white transition-colors border-l-4 ${selectedCallIndex === idx ? 'bg-white border-blue-600 ' : 'border-transparent'}`}
                                            >
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 uppercase ${call.direction === 'outgoing' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                        {call.direction === 'outgoing' ? 'Исходящий' : 'Входящий'}
                                                    </span>
                                                    {/* Закон владельца 05.10.2026: звонок состоялся, только если
                                                        был разговор с клиентом. Попытку дозвона Телфин отдаёт
                                                        как отвеченный звонок с длительностью — её временем не
                                                        подписываем, иначе выдаём за разговор. */}
                                                    {call.answered === false ? (
                                                        <span className="text-[9px] font-black text-amber-700 bg-amber-50 px-1.5 py-0.5 uppercase">Дозвона не было</span>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400 font-mono">{call.duration_sec}s</span>
                                                    )}
                                                </div>
                                                <div className="text-xs font-semibold text-gray-800 flex justify-between">
                                                    <span>{new Date(call.started_at).toLocaleDateString('ru-RU')}</span>
                                                    <span className="text-[10px] text-gray-500 font-normal">{new Date(call.started_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                {call.match_explanation?.includes('[Внимание: звонил другой менеджер]') && (
                                                    <div className="mt-1 text-[9px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 inline-block">⚠️ Другой менеджер</div>
                                                )}
                                                {call.transcript && (
                                                    <div className="mt-2 text-[10px] text-blue-500 flex items-center gap-1">
                                                        <span>📝 Транскрибация</span>
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </aside>

                            <div className={`${qualityMobileTab !== 'calls' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 bg-white`}>
                                {qualityCalls.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8 text-center">
                                        <div>
                                            <div className="text-4xl mb-4">📞</div>
                                            К заказу пока не привязаны звонки — разбор появится после их привязки.
                                        </div>
                                    </div>
                                ) : activeCall ? (
                                    <div className="flex-1 flex flex-col overflow-hidden">
                                        <div className="p-3 md:p-4 border-b bg-white flex flex-col md:flex-row md:items-center gap-3">
                                            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 w-full">
                                                <div>
                                                    <span className="text-[9px] text-gray-400 uppercase font-black block">Откуда · Куда</span>
                                                    <span className="text-xs font-mono font-bold text-gray-700">
                                                        {(activeCall.from_number || activeCall.from_number_normalized) || '—'} → {(activeCall.to_number || activeCall.to_number_normalized) || '—'}
                                                    </span>
                                                </div>
                                                {activeCall.recording_url && (
                                                    <div className="flex items-center gap-2 w-full md:w-auto">
                                                        <audio
                                                            src={activeCall.raw_payload?.storage_url || `/api/okk/proxy-audio?url=${encodeURIComponent(activeCall.recording_url)}`}
                                                            controls
                                                            className="h-10 md:h-8 md:w-64 w-full accent-blue-600"
                                                        />
                                                        <a
                                                            href={activeCall.raw_payload?.storage_url || activeCall.recording_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="hidden md:flex p-1.5 px-3 text-xs font-bold border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-200"
                                                        >
                                                            Скачать
                                                        </a>
                                                    </div>
                                                )}
                                                <div className="flex flex-col gap-1 w-full md:w-auto">
                                                    <span className="text-[9px] text-gray-400 uppercase font-black">Позвонить клиенту</span>
                                                    {managerIdString ? (
                                                        callNumbers.length > 0 ? (
                                                            <div className="flex flex-wrap items-center gap-4">
                                                                {callNumbers.map((number, idx) => (
                                                                    <div key={`${number}-${idx}`} className="flex flex-col gap-1 min-w-[150px]">
                                                                        <span className="text-[10px] text-gray-500 uppercase">{idx === 0 ? 'Основной' : 'Дополнительный'}</span>
                                                                        <span className="text-xs font-mono text-gray-900">{number}</span>
                                                                        <CallInitiator phoneNumber={number} managerId={managerIdString} orderId={orderIdString} />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[11px] text-gray-400">Телефон не найден</span>
                                                        )
                                                    ) : (
                                                        <span className="text-[11px] text-gray-400">Назначьте менеджера, чтобы звонить прямо отсюда</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                                            <div className={`${qualityMobileTab === 'transcript' ? 'flex' : 'hidden'} md:flex flex-1 flex-col border-r overflow-hidden`}>
                                                <div className="p-3 bg-gray-50/70 border-b hidden md:block">
                                                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Текст разговора</h5>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 bg-gray-50/40">
                                                    {activeCall.transcript ? (
                                                        <div className="text-xs md:text-sm text-gray-700 leading-relaxed space-y-2">
                                                            {activeCall.transcript.split('\n').map((line: string, i: number) => {
                                                                const managerLine = line.startsWith('Менеджер:');
                                                                const clientLine = line.startsWith('Клиент:');
                                                                if (managerLine) {
                                                                    return (
                                                                        <div key={i} className="bg-white border border-blue-100 px-3 py-2">
                                                                            <span className="text-blue-700 font-bold">Менеджер:</span> {line.replace('Менеджер:', '').trim()}
                                                                        </div>
                                                                    );
                                                                }
                                                                if (clientLine) {
                                                                    return (
                                                                        <div key={i} className="bg-white border border-orange-100 px-3 py-2">
                                                                            <span className="text-orange-600 font-bold">Клиент:</span> {line.replace('Клиент:', '').trim()}
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <div key={i} className="px-3 py-1 text-gray-600">{line}</div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                                                            <span className="text-3xl">🔇</span>
                                                            {activeCall.recording_url ? (
                                                                <button
                                                                    onClick={handleTranscribeCall}
                                                                    disabled={transcribing}
                                                                    className="px-4 py-2 bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 disabled:opacity-50 border border-blue-100"
                                                                >
                                                                    {transcribing ? 'Обработка...' : 'Запустить транскрибацию'}
                                                                </button>
                                                            ) : (
                                                                <p className="text-xs italic">Нет записи — нечего расшифровывать</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className={`${qualityMobileTab === 'analysis' ? 'flex' : 'hidden'} md:flex w-full md:w-96 flex-col bg-gray-50/40 overflow-hidden`}>
                                                <div className="p-3 bg-fuchsia-50 border-b border-fuchsia-100 flex items-center gap-2">
                                                    <span className="text-lg">🤓</span>
                                                    <div>
                                                        <h5 className="text-xs font-bold text-fuchsia-900">Анализ Максима</h5>
                                                        <p className="text-[9px] text-fuchsia-600 font-black uppercase tracking-widest">Сводный срез по всем звонкам</p>
                                                    </div>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4">
                                                    {qualityScore?.evaluator_comment ? (
                                                        <div>
                                                            <h6 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                                                <span>📋</span> Общее резюме
                                                            </h6>
                                                            <div className="text-xs text-gray-800 bg-white p-3 border border-gray-100 leading-relaxed">
                                                                {qualityScore.evaluator_comment}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-center text-xs text-gray-400 italic py-6">
                                                            Анализ ещё не выполнен.
                                                        </div>
                                                    )}

                                                    {scoreBreakdownEntries.length > 0 && (
                                                        <div>
                                                            <h6 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                                                <span>🔍</span> Ключевые моменты
                                                            </h6>
                                                            <div className="space-y-2">
                                                                {scoreBreakdownEntries.filter(([key]) => isVisibleBreakdownKey(key)).map(([key, info]) => (
                                                                    <div key={key} className="bg-white p-3 border border-gray-100">
                                                                        <div className="flex items-center gap-1.5 mb-1.5">
                                                                            <span className={info?.result ? 'text-green-500' : 'text-red-500'}>
                                                                                {info?.result ? '✅' : '❌'}
                                                                            </span>
                                                                            <span className="text-[10px] font-bold text-gray-700">
                                                                                {formatQualityCriterionLabel(key)}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-[11px] text-gray-600 leading-normal italic">{info?.reason}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8 text-center">
                                        <div>
                                            <div className="text-4xl mb-4">👆</div>
                                            Выберите звонок слева, чтобы увидеть детали.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </section>
        );
    };

    return (
        <FieldErrorsContext.Provider value={fieldErrors}>
        <FieldDirtyContext.Provider value={dirtyKeys}>
        {/* Свёрнутые блоки помнятся за человеком, а не за браузером. */}
        <CardSectionsProvider>
        <div
            className="fixed z-[130] flex"
            role="dialog"
            aria-modal="true"
            data-ui-audit="order-modal"
            // Цвет — от статуса заказа, еле заметный; размеры — по рабочей области.
            style={{
                backgroundColor: tintFromColor(data?.statusColor, 0.07) || '#ffffff',
                top: frame?.top ?? 0,
                left: frame?.left ?? 0,
                width: frame?.width ?? '100%',
                height: frame?.height ?? '100%',
            }}
        >
            <div
                className="flex h-full w-full flex-col overflow-hidden"
                style={{ backgroundColor: tintFromColor(data?.statusColor, 0.07) || '#ffffff' }}
            >
                <header
                    className={`border-b transition-all ${compactHeader ? 'px-4 py-1 md:px-6' : 'px-4 py-2.5 md:px-6 md:py-3'}`}
                    style={{ backgroundColor: tintFromColor(data?.statusColor, 0.14) || '#ffffff' }}
                >
                    <div className={`flex flex-wrap justify-between gap-2 md:gap-6 ${compactHeader ? 'items-center' : 'items-start'}`}>
                        <div className="min-w-0">
                            {!compactHeader && <p className="text-[10px] uppercase tracking-wide text-gray-400">Заявка</p>}
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className={compactHeader ? 'text-base font-bold text-gray-900' : 'text-xl font-semibold text-gray-900'}>
                                    Заказ #{data?.order?.number ?? orderId}
                                </h2>
                                {/* В ужатом виде — то же, что у RetailCRM: номер, сумма, дата. */}
                                {compactHeader && data?.order && (
                                    <span className="text-sm text-gray-700">
                                        <span className="mx-1 text-gray-400">•</span>
                                        <strong>{formatCurrency(data.order.totalsumm)}</strong>
                                        <span className="mx-1 text-gray-400">•</span>
                                        {formatDateTime(data.order.created_at)}
                                    </span>
                                )}
                                {/* Свой заказ ведётся только у нас — менеджер должен это видеть:
                                    в RetailCRM его нет, и искать там нечего. */}
                                {data?.order?.is_own && (
                                    <span className="bg-gray-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                                        Наша база
                                    </span>
                                )}
                            </div>
                            {data?.order && !compactHeader && (
                                <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-gray-600">
                                    <span>Сумма: <strong>{formatCurrency(data.order.totalsumm)}</strong></span>
                                    <span>Поступил: {formatDateTime(data.order.created_at)}</span>
                                    <span>Менеджер: {data.order.manager_name || '—'}</span>
                                </div>
                            )}
                            {/* Блок светофора по контрагенту */}
                            {compactHeader ? null : counterpartyScoreLoading ? (
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">Проверка контрагента...</div>
                            ) : counterpartyScore ? (
                                <div className="mt-1 flex items-center gap-2">
                                    <span className={`inline-block w-2.5 h-2.5 ${
                                        counterpartyScore.risk_score === 'red' ? 'bg-red-500' :
                                        counterpartyScore.risk_score === 'yellow' ? 'bg-yellow-400' :
                                        'bg-green-500'
                                    }`}></span>
                                    <span className="text-[11px] font-semibold">
                                        {counterpartyScore.summary}
                                    </span>
                                </div>
                            ) : null}
                        </div>

                        {/* Deal Score Header Block */}
                        <div className={`flex items-center gap-3 ml-auto mr-3 group relative ${compactHeader ? 'hidden' : ''}`}>
                            <div className="text-right">
                                <p className="text-[9px] uppercase tracking-widest font-black text-gray-400">Deal Score</p>
                                {qualityScoreLoading ? (
                                    <div className="h-6 w-12 bg-gray-100 animate-pulse ml-auto"></div>
                                ) : (
                                    <>
                                        <p className="text-2xl font-black text-blue-600 leading-none">
                                            {qualityScore?.deal_score_pct !== undefined && qualityScore?.deal_score_pct !== null ? `${qualityScore.deal_score_pct}%` : '—'}
                                        </p>
                                        {qualityScore?.deal_score !== undefined && qualityScore?.deal_score !== null && (
                                            <p className="text-[10px] text-gray-500">({qualityScore.deal_score}/100)</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Одна строка, а не две: вторая строка кнопок съедала
                            высоту рабочей области (требование владельца
                            02.10.2026). Поэтому панель не переносится, а на
                            узком экране прокручивается по горизонтали. */}
                        <div className={`flex flex-nowrap items-center overflow-x-auto ${compactHeader ? 'gap-1 [&_a]:px-2 [&_a]:py-0.5 [&_a]:text-[11px] [&_button]:px-2 [&_button]:py-0.5 [&_button]:text-[11px] [&_select]:px-2 [&_select]:py-0.5 [&_select]:text-[11px]' : 'mt-1 gap-1 [&_a]:px-2 [&_a]:py-0.5 [&_a]:text-[11px] [&_button]:px-2 [&_button]:py-0.5 [&_button]:text-[11px] [&_select]:px-2 [&_select]:py-0.5 [&_select]:text-[11px]'}`}>
                            {/* КП и счёт собираются из самого заказа: позиции, плательщик из
                                контрагента, продавец из реквизитов магазина в RetailCRM.
                                Ничего не вводится руками — документ всегда совпадает с заказом. */}
                            {/* Юрлиц у компании несколько, у каждого свои реквизиты —
                                счёт и КП можно выставить от любого. */}
                            <select
                                value={sellerCode}
                                onChange={(e) => setSellerCode(e.target.value)}
                                className="w-36 shrink-0 border border-gray-200 text-gray-700"
                                title="От какого юрлица выставляем документы"
                            >
                                <option value="">Юрлицо заказа</option>
                                {sellerOptions.map((option) => (
                                    <option key={option.code} value={option.code}>{option.name}</option>
                                ))}
                            </select>
                            <a
                                href={`/api/orders/${orderId}/document?kind=proposal${sellerCode ? `&seller=${sellerCode}` : ''}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 whitespace-nowrap border border-gray-200 text-gray-700 hover:bg-gray-50"
                            >
                                Коммерческое предложение
                            </a>
                            <a
                                href={`/api/orders/${orderId}/document?kind=invoice${sellerCode ? `&seller=${sellerCode}` : ''}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 whitespace-nowrap border border-gray-200 text-gray-700 hover:bg-gray-50"
                            >
                                Счёт на оплату
                            </a>
                            {/* Договор собирается по нашему шаблону и уходит юристу на
                                согласование — менеджер пишет только условия словами. */}
                            <button
                                onClick={() => setContractOpen(true)}
                                className="shrink-0 whitespace-nowrap border border-gray-200 text-gray-700 hover:bg-gray-50"
                            >
                                Составить договор
                            </button>
                            <div className="relative">
                                <button
                                    onClick={() => setPrintOpen((v) => !v)}
                                    className="shrink-0 whitespace-nowrap border border-gray-200 text-gray-700 hover:bg-gray-50"
                                >
                                    Печать
                                </button>
                                {printOpen && (
                                    <div className="absolute right-0 z-20 mt-1 min-w-[220px] border border-gray-300 bg-white shadow-none">
                                        {printTemplates.length === 0 ? (
                                            <p className="px-3 py-2 text-xs text-gray-500">
                                                Печатных форм нет. Заведите их в настройках.
                                            </p>
                                        ) : (
                                            printTemplates.map((t) => (
                                                <a
                                                    key={t.id}
                                                    href={`/api/orders/${data?.order?.number ?? orderId}/print/${t.code}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={() => setPrintOpen(false)}
                                                    className="block px-3 py-2 text-sm text-gray-800 hover:bg-blue-600 hover:text-white"
                                                >
                                                    {t.name}
                                                </a>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                            {/* Переписка по заказу тредами: раздел «Переписка»
                                (docs/order-mail/TZ.md). Счётчик — непрочитанные
                                письма клиента. */}
                            <button
                                onClick={() => setPanel(panel === 'mail' ? null : 'mail')}
                                className={`shrink-0 whitespace-nowrap border ${panel === 'mail' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                            >
                                Переписка{mailUnread ? ` · ${mailUnread}` : ''}
                            </button>
                            <button
                                onClick={() => setPanel(panel === 'tasks' ? null : 'tasks')}
                                className={`shrink-0 whitespace-nowrap border ${panel === 'tasks' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                            >
                                Задачи {taskCount ? `${taskCount.done}/${taskCount.total}` : ''}
                            </button>
                            <button
                                onClick={() => setPanel(panel === 'files' ? null : 'files')}
                                className={`shrink-0 whitespace-nowrap border ${panel === 'files' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                            >
                                Файлы
                            </button>
                            <button
                                onClick={() => setPanel(panel === 'history' ? null : 'history')}
                                className={`shrink-0 whitespace-nowrap border ${panel === 'history' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                            >
                                История
                            </button>
                            {/* Статус — справа в той же полосе, как в RetailCRM: одно
                                место, человеческим языком, с цветом этапа. */}
                            <OrderStatusSwitcher
                                orderId={data?.order?.number ?? orderId}
                                currentLabel={statusLabel ?? 'Сменить статус'}
                                color={data?.statusColor ?? null}
                                onChanged={() => fetchDetails()}
                            />
                            <button onClick={onClose} className="shrink-0 border border-gray-300 text-gray-500 hover:bg-gray-50">✕</button>
                        </div>
                    </div>
                    {/* Пометки клиента — рядом со статусом, одной строкой. */}
                    {headerBadges.length > 0 && (
                        <div className={`flex flex-wrap items-center gap-1.5 text-[11px] font-semibold ${compactHeader ? 'hidden' : 'mt-1'}`}>
                            {headerBadges.map(badge => (
                                <span key={badge.label} className={`px-2 py-0.5 ${badge.className}`}>
                                    {badge.label}
                                </span>
                            ))}
                        </div>
                    )}
                </header>

                {panel && (
                    <div className="border-b bg-gray-50 px-6 py-3">
                        <OrderSidePanel
                            kind={panel}
                            orderNumber={String(data?.order?.number ?? orderId)}
                            history={data?.history}
                            statusPalette={data?.statusPalette}
                            onClose={() => setPanel(null)}
                            onTasksChanged={(done, total) => setTaskCount({ done, total })}
                            onMailUnread={setMailUnread}
                        />
                    </div>
                )}

                <nav className="border-b bg-white px-6">
                    <div className="flex overflow-x-auto text-sm">
                        {viewTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setViewTab(tab.id)}
                                className={`${compactHeader ? 'py-1 text-[13px]' : 'py-2.5 text-sm'} px-4 border-b-2 -mb-px transition-colors ${viewTab === tab.id ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <main
                    className="flex-1 overflow-y-auto bg-slate-50 px-4 py-3"
                    onScroll={(e) => {
                        // Небольшой запас, чтобы шапка не дрожала на границе.
                        const top = (e.target as HTMLElement).scrollTop;
                        setCompactHeader((prev) => (prev ? top > 20 : top > 60));
                    }}
                >
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin h-10 w-10 border-b-2 border-blue-600"></div>
                        </div>
                    ) : error ? (
                        <div className="p-4 bg-red-50 text-red-600">Ошибка загрузки: {error}</div>
                    ) : (
                        data && (
                            <div className="space-y-4">
                                {viewTab === 'card' ? (
                                    <>
                                        <div className="bg-white border border-gray-200 px-4 py-2 flex flex-wrap gap-2 text-sm">
                                            {sectionNavItems.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => handleSectionNavClick(item.id)}
                                                    className="px-3 py-1 text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                        {renderCardContent()}
                                    </>
                                ) : viewTab === 'tech' ? (
                                    renderTechView()
                                ) : viewTab === 'production' ? (
                                    renderProductionView()
                                ) : (
                                    renderQualityView()
                                )}
                            </div>
                        )
                    )}
                </main>

                {/* Нижняя полоса вдвое ниже прежней: это служебные кнопки, а место
                    на экране нужно данным заказа (требование владельца 01.10.2026). */}
                <footer
                    className="flex items-center justify-between border-t px-4 py-1"
                    style={{ backgroundColor: tintFromColor(data?.statusColor, 0.14) || '#ffffff' }}
                >
                    <div className="flex items-center gap-2">
                        {/* Кнопки активны всегда. Раньше они гасли, пока в
                            черновике нет правок, — но карточка умеет меняться и
                            помимо него: передача заказа другому менеджеру идёт
                            своим запросом. Владелец 05.10.2026: «перевёл на Ирину
                            — а выйти можно только закрыв окно браузера». Без
                            изменений «Сохранить» просто скажет, что их не было. */}
                        <button
                            onClick={saveOrder}
                            disabled={savingOrder}
                            className="bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400"
                        >
                            {savingOrder ? 'Сохраняю…' : 'Сохранить'}
                        </button>
                        <button
                            onClick={async () => { if (dirty) await saveOrder(); onClose(); }}
                            disabled={savingOrder}
                            className="bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:text-gray-400"
                        >
                            Сохранить и выйти
                        </button>
                        {saveNote && <span className="text-[11px] text-gray-600">{saveNote}</span>}
                        {dirty && !saveNote && <span className="text-[11px] text-amber-700">Есть несохранённые изменения</span>}
                    </div>
                    <button onClick={onClose} className="border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">Закрыть</button>
                </footer>
            </div>
        </div>
        </CardSectionsProvider>
        </FieldDirtyContext.Provider>
        </FieldErrorsContext.Provider>
    );
}
