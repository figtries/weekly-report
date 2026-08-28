import { getDb } from '@/lib/data';
import SetupWizard from '@/components/setup/SetupWizard';

export const metadata = { title: 'Project Setup' };

export default async function SetupPage() {
  const db = await getDb();
  return <SetupWizard hasExistingProject={db.wbsItems.length > 0} />;
}
