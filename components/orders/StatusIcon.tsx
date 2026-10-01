'use client';

/**
 * Иконка этапа статусов.
 *
 * В RetailCRM этап узнаётся по иконке раньше, чем прочитан текст, и менеджеры
 * к этому привыкли. Их API иконок не отдаёт, поэтому набор свой, а какая иконка
 * у какого этапа — выбирает человек в настройке этапа (требование владельца
 * 01.10.2026).
 */
import {
    Lightbulb,
    MessageSquare,
    User,
    Gavel,
    CheckCircle2,
    Truck,
    Megaphone,
    XCircle,
    Factory,
    FileSignature,
    Wallet,
    Wrench,
    Clock,
    AlertTriangle,
    Handshake,
    ArrowDownCircle,
    type LucideIcon,
} from 'lucide-react';

/** Набор иконок: код в базе → что рисуем и как называется для человека. */
export const STATUS_ICONS: Array<{ code: string; label: string; Icon: LucideIcon }> = [
    { code: 'lamp', label: 'Лампочка — новая заявка', Icon: Lightbulb },
    { code: 'chat', label: 'Переписка — согласование', Icon: MessageSquare },
    { code: 'person', label: 'Человек', Icon: User },
    { code: 'tender', label: 'Молоток — тендер', Icon: Gavel },
    { code: 'done', label: 'Галочка — выполнено', Icon: CheckCircle2 },
    { code: 'delivery', label: 'Машина — доставка', Icon: Truck },
    { code: 'marketing', label: 'Рупор — маркетинг', Icon: Megaphone },
    { code: 'cancel', label: 'Крест — отменён', Icon: XCircle },
    { code: 'production', label: 'Завод — производство', Icon: Factory },
    { code: 'contract', label: 'Договор', Icon: FileSignature },
    { code: 'payment', label: 'Кошелёк — оплата', Icon: Wallet },
    { code: 'service', label: 'Ключ — доработки', Icon: Wrench },
    { code: 'waiting', label: 'Часы — ожидание', Icon: Clock },
    { code: 'claim', label: 'Внимание — рекламация', Icon: AlertTriangle },
    { code: 'client', label: 'Рукопожатие — работа с клиентом', Icon: Handshake },
    { code: 'incoming', label: 'Стрелка вниз — поступление', Icon: ArrowDownCircle },
];

const BY_CODE = new Map(STATUS_ICONS.map((i) => [i.code, i.Icon]));

export default function StatusIcon({
    icon,
    color,
    size = 14,
    className,
}: {
    icon?: string | null;
    color?: string | null;
    size?: number;
    className?: string;
}) {
    const Icon = icon ? BY_CODE.get(icon) : undefined;

    if (!Icon) {
        return null;
    }

    return <Icon size={size} color={color || undefined} className={className} strokeWidth={2.5} />;
}
