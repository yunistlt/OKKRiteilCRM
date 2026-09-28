// Карточка дела: текущее состояние и вся история по одному спору.
import MatterCard from '../../../components/MatterCard';

export const dynamic = 'force-dynamic';

export default function MatterPage({ params }: { params: { id: string } }) {
  return <MatterCard id={Number(params.id)} />;
}
