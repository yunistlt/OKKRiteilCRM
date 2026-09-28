// Реестр претензионно-исковой работы: один конфликт — одна строка.
import MattersRegistry from '../../components/MattersRegistry';

export const dynamic = 'force-dynamic';

export default function MattersPage() {
  return <MattersRegistry />;
}
