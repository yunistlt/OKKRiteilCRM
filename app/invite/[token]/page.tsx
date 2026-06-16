import { getInvitationInfo } from '../actions';
import InviteAcceptClient from './invite-accept-client';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: { token: string } }) {
    const info = await getInvitationInfo(params.token);

    if (!info.valid) {
        return (
            <div className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center px-4 py-10">
                <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl shadow-gray-100">
                    <h1 className="text-2xl font-black text-gray-900 mb-2">Ссылка недействительна</h1>
                    <p className="text-sm text-gray-500">Это приглашение отозвано или больше не действует. Запросите у администратора новую ссылку.</p>
                </div>
            </div>
        );
    }

    return <InviteAcceptClient token={params.token} role={info.role!} firstName={info.first_name} lastName={info.last_name} note={info.note} />;
}
