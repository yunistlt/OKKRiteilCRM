// Карточка одного исполнительного производства.
import Link from 'next/link';
import EnforcementCaseCard from '../../../components/EnforcementCaseCard';

export const dynamic = 'force-dynamic';

export default function EnforcementCasePage({ params }: { params: { id: string } }) {
  const caseId = Number(params.id);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <Link href="/legal" className="text-xs font-semibold text-gray-600 hover:text-gray-900">
        ← Реестр исполнительных производств
      </Link>
      {Number.isInteger(caseId) && caseId > 0 ? (
        <EnforcementCaseCard caseId={caseId} />
      ) : (
        <div className="mt-3 bg-white p-3 text-xs text-red-700">Неверный адрес карточки.</div>
      )}
    </div>
  );
}
