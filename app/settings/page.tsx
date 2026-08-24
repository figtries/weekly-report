import { getDb } from '@/lib/data';
import { getCatalogs } from '@/lib/catalogs';
import CatalogEditor from '@/components/settings/CatalogEditor';

export const metadata = { title: 'Pengaturan Proyek' };

export default async function SettingsPage() {
  const db = await getDb();
  const cat = getCatalogs(db);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in-up px-3 py-5 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pengaturan Proyek</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Kategori di bawah ini milik proyek ini, bukan bawaan aplikasi. Proyek lain punya
          daftarnya sendiri — inilah yang membuat app ini bisa dipakai perusahaan mana pun.
          Perubahan berlaku untuk laporan berikutnya; laporan yang sudah terbit tidak diubah.
        </p>
      </header>

      <div className="space-y-4">
        <CatalogEditor catalogKey="weather" entries={cat.weather} />
        <CatalogEditor catalogKey="delayCause" entries={cat.delayCause} />
        <CatalogEditor catalogKey="hse" entries={cat.hse} />
        <CatalogEditor catalogKey="crew" entries={cat.crew} />
      </div>
    </div>
  );
}
