import ClientCard from '@/app/components/ClientCard';

export const dynamic = 'force-dynamic';

export default function ClientPage({ params }: { params: { id: string } }) {
    return <ClientCard clientId={params.id} />;
}
