import EditOrderForm from '@/app/components/EditOrderForm';

export const dynamic = 'force-dynamic';

export default function EditOrderPage({ params }: { params: { id: string } }) {
    return <EditOrderForm orderId={params.id} />;
}
