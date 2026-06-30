import Link from 'next/link';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import RelevanceClient from './RelevanceClient';

export const dynamic = 'force-dynamic';

export default async function RelevancePage() {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return (
            <div className="p-6 text-sm text-slate-600">
                Доступ только для ролей администратор / РОП.
                <div className="mt-2"><Link href="/agents" className="text-blue-600 hover:underline">← К агентам</Link></div>
            </div>
        );
    }

    const { data: managers } = await supabase
        .from('managers')
        .select('id, first_name, last_name, active')
        .order('last_name', { ascending: true });

    const managerOptions = (managers || []).map((m: any) => ({
        id: m.id,
        name: [m.last_name, m.first_name].filter(Boolean).join(' ') || `#${m.id}`,
        active: m.active,
    }));

    return (
        <div className="w-full min-h-full bg-[#eef3f7] p-4 md:p-6">
            <div className="mb-4">
                <Link href="/agents" className="text-xs text-blue-600 hover:underline">← К агентам</Link>
                <h1 className="mt-1 text-lg font-black uppercase tracking-wide text-slate-800">
                    Письма об актуальности отложенных заказов
                </h1>
                <p className="text-xs text-slate-500">
                    Заказы в статусе «Отложено», переведённые туда за период. Письмо включает состав заказа
                    и персональный «толчок к покупке» по причине переноса. Перед отправкой — предпросмотр.
                </p>
            </div>
            <RelevanceClient managers={managerOptions} />
        </div>
    );
}
