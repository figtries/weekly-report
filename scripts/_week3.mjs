import fs from 'node:fs';

const patch = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf-8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.error(`MISS in ${file}: ${a.slice(0, 90)}`); process.exit(1); }
    s = s.split(a).join(b);
  }
  fs.writeFileSync(file, s);
  console.log('week-aware:', file);
};

/* ---------------------------------------------------------- workbench */
patch('components/dokumen/RegisterWorkbench.tsx', [
  [`export function RegisterWorkbench({
  projectId,
  register,
  tree,
  cards,
  asOfDate,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  asOfDate: string;
}) {`,
   `export function RegisterWorkbench({
  projectId,
  register,
  tree,
  cards,
  weekNo,
  weekEndDate,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  /** The week being reported. Every figure below is as it stood at its end. */
  weekNo: number;
  weekEndDate: string;
}) {`],
  [`          doc={openDoc}
          asOfDate={asOfDate}`,
   `          doc={openDoc}
          asOfDate={weekEndDate}`],
  [`          defaultStage={defaultStage}`,
   `          defaultStage={defaultStage}
          // A submission recorded while reporting week N belongs in week N,
          // so the date starts there instead of empty.
          defaultDate={weekEndDate}`],
  [`                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {selected.packageName}
                </p>`,
   `                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {selected.packageName} · week {weekNo}
                </p>`],
]);

/* ------------------------------------------------------------- dialog */
patch('components/dokumen/RecordDialog.tsx', [
  [`  documentLabels,
  defaultStage,
  onDone,
}: {`,
   `  documentLabels,
  defaultStage,
  defaultDate,
  onDone,
}: {`],
  [`  documentLabels: string[];
  defaultStage: string;`,
   `  documentLabels: string[];
  defaultStage: string;
  /** The end of the week being reported — where a new record starts. */
  defaultDate: string;`],
  [`  const [date, setDate] = useState('');`, `  const [date, setDate] = useState(defaultDate);`],
  [`      setTransmittalNo(''); setDate(''); setDocNo(''); setTitle('');`,
   `      setTransmittalNo(''); setDate(defaultDate); setDocNo(''); setTitle('');`],
]);

/* ---------------------------------------------------------------- log */
patch('components/dokumen/LogScreen.tsx', [
  [`export function LogScreen({ events }: { events: TaggedEvent[] }) {`,
   `export function LogScreen({ events, weekNo }: { events: TaggedEvent[]; weekNo: number }) {`],
  [`        <span className="flex h-11 items-center text-xs text-muted-foreground">
          {shown.length} events
        </span>`,
   `        <span className="flex h-11 items-center text-xs text-muted-foreground">
          {shown.length} events up to the end of week {weekNo}
        </span>`],
]);

/* ------------------------------------------------------------ summary */
patch('components/dokumen/SummaryScreen.tsx', [
  [`              <p className="text-xs leading-relaxed text-white/60">
                {summary.documents} documents · {summary.categories} groups
                {summary.numbered < summary.documents && \` · \${summary.documents - summary.numbered} unnumbered\`}
              </p>`,
   `              <p className="text-xs leading-relaxed text-white/60">
                {summary.documents} documents · {summary.categories} groups
                {summary.numbered < summary.documents && \` · \${summary.documents - summary.numbered} unnumbered\`}
                {/* Looking past the register's own last movement is allowed, and
                    saying so is the difference between a flat week and a stale
                    file. */}
                {summary.evidenceWeek < summary.asOfWeek && (
                  <>
                    <br />
                    Nothing has moved in this register since week {summary.evidenceWeek}
                    {' '}({longDate(summary.evidenceDate)}).
                  </>
                )}
              </p>`],
]);

/* ------------------------------------------------------------ sidebar */
patch('components/layout/Sidebar.tsx', [
  [`    href: () => '/dokumen',
    match: (p) => p.startsWith('/dokumen'),
  },`,
   `    href: (w) => \`/dokumen/\${w}/summary\`,
    match: (p) => p.startsWith('/dokumen'),
    warm: (w) => [\`/dokumen/\${w}/summary\`, \`/dokumen/\${w}/data\`],
  },`],
]);
