/**
 * Membuktikan Summary dan Data sebuah register mengatakan hal yang sama,
 * untuk setiap proyek, setiap minggu, EDL dan VDRL (8 Oct 2026).
 *
 * Data punya aturan Needs action sendiri dan menyimpang dari Summary: dokumen
 * 100% yang menunggu balasan AFC masuk Needs action, "due soon" hanya ada di
 * Summary, dan dokumen yang sedang di client dihitung telat. Sekarang keduanya
 * membaca `DocumentCard.action` / `getObstacles`, yang dibangun satu fungsi
 * (`actionOf` di lib/register.ts). Skrip ini menjaga agar tetap begitu.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-register-agree.ts
 */
import { db, schema } from '../lib/sqlite.ts';
import {
  REPLY_DAYS, getObstacles, getRegisterCards, getRegisterSummary, getRegisterTree, getRegisterWeeks,
  isFull, needsAction, withUs, type DocumentCard, type RegisterNode,
} from '../lib/register.ts';

const failures: string[] = [];
let checks = 0;
const fail = (where: string, what: string) => { if (failures.length < 40) failures.push(`${where}: ${what}`); };
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const projects = [...new Set(db.select({ id: schema.documents.projectId }).from(schema.documents).all().map((r) => r.id))];

for (const projectId of projects) {
  const weeks = getRegisterWeeks(projectId).map((w) => w.weekNo);
  for (const register of ['edl', 'vdrl'] as const) {
    for (const week of weeks) {
      const summary = getRegisterSummary(projectId, register, week);
      if (!summary) continue;
      const where = `${projectId} ${register} W${week}`;
      const tree = getRegisterTree(projectId, register, week);
      const cards = getRegisterCards(projectId, register, week);
      const obstacles = getObstacles(projectId, register, week);

      // The Data screen's groups: the leaves of the tree, as RegisterWorkbench walks it.
      const leaves: RegisterNode[] = [];
      const walk = (n: RegisterNode) => (n.children.length ? n.children.forEach(walk) : leaves.push(n));
      tree.forEach(walk);
      const all: DocumentCard[] = leaves.flatMap((g) => cards[g.id] ?? []);
      checks += 1;

      // All on Data = documents on the Summary: no document hidden from the list.
      if (all.length !== summary.documents) fail(where, `Data lists ${all.length}, Summary counts ${summary.documents}`);

      // Needs action: the same documents, so the same count.
      const listed = new Set(obstacles.filter((o) => o.kind !== 'untouched').map((o) => o.documentId));
      const chip = new Set(all.filter(needsAction).map((c) => c.id));
      for (const id of chip) if (!listed.has(id)) fail(where, `${id} in Data's Needs action, not the Summary's`);
      for (const id of listed) if (!chip.has(id)) fail(where, `${id} in the Summary's Needs action, not Data's`);

      // With us / With client: the Summary's column counts are Data's chips.
      const us = all.filter(withUs).length;
      const them = all.filter((c) => c.out !== null).length;
      if (summary.withUs !== us) fail(where, `With us: Summary ${summary.withUs}, Data ${us}`);
      if (summary.awaiting !== them) fail(where, `With client: Summary ${summary.awaiting}, Data ${them}`);

      for (const c of all) {
        const a = c.action;
        const doc = `${where} ${c.docNo ?? c.id}`;
        // The user's rule: a document at 100% never needs action.
        if (isFull(c.percent) && a) fail(doc, `at ${c.percent}% but ${a.kind}`);
        // With the other side, the only reason is a reply past the review.
        if (c.out && a && a.kind !== 'waiting') fail(doc, `out with the other side but ${a.kind}`);
        if (a?.kind === 'waiting' && !(c.out && (c.out.days ?? 0) > REPLY_DAYS)) fail(doc, 'waiting without a reply past the review');
        // What it says to send is what Send offers.
        if (a && a.kind !== 'waiting' && a.kind !== 'untouched' && a.next !== c.sendNext) {
          fail(doc, `${a.kind} says send ${a.next}, Send offers ${c.sendNext}`);
        }
        // A code is shown only while it is unanswered, the same code as the Summary's.
        if (c.returnCode && c.out) fail(doc, `shows ${c.returnCode} while ${c.out.stage} is out`);
        if (a?.kind === 'comments' && a.returnCode !== c.returnCode) fail(doc, `comments ${a.returnCode}, row shows ${c.returnCode}`);
      }

      // A group's figure is its rows' figures: the bar never disagrees with the list under it.
      for (const g of leaves) {
        const docs = cards[g.id] ?? [];
        if (docs.length && !same(g.actual, docs.reduce((s, c) => s + c.percent, 0) / docs.length)) {
          fail(where, `${g.name} reads ${g.actual}, its rows average otherwise`);
        }
      }
      if (all.length && !same(summary.actual, all.reduce((s, c) => s + c.percent, 0) / all.length)) {
        fail(where, `Summary reads ${summary.actual}, the rows average otherwise`);
      }
    }
  }
}

console.log(`${projects.length} project(s), ${checks} register-weeks checked`);
if (failures.length) {
  console.log(failures.map((f) => `  FAIL  ${f}`).join('\n'));
  process.exit(1);
}
console.log('  ok    Summary and Data agree on every count, row and figure');
