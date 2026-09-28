// Юридический отдел — реестр исполнительных производств.
// Раньше здесь был дашборд с плитками базы знаний; helpdesk Дарьи никуда не делся,
// он переехал на /legal/helpdesk, ссылка есть в шапке реестра.
import EnforcementRegistry from '../components/EnforcementRegistry';

export const dynamic = 'force-dynamic';

export default function LegalPage() {
  return <EnforcementRegistry />;
}
