import fs from 'node:fs';

const patch = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf-8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { console.error(`MISS in ${file}: ${JSON.stringify(a.slice(0, 80))}`); process.exit(1); }
    s = s.split(a).join(b);
  }
  fs.writeFileSync(file, s);
  console.log('ok:', file);
};

/* the editor loses the column */
patch('components/dokumen/DocumentEditor.tsx', [
  [`const CODES = ['', 'APP', 'AWC', 'RWC'];

`, ``],
  [`              <th className="pb-1 font-medium">Letter</th>
              <th className="w-24 pb-1 font-medium">Code</th>`,
   `              <th className="pb-1 font-medium">Letter</th>`],
  [`  const [draft, setDraft] = useState({
    sentAt: row?.submittedAt ?? '',
    sentTransmittal: row?.submitTransmittal ?? '',
    returnedAt: row?.returnedAt ?? '',
    returnTransmittal: row?.returnTransmittal ?? '',
    returnCode: row?.returnCode ?? '',
  });`,
   `  const [draft, setDraft] = useState({
    sentAt: row?.submittedAt ?? '',
    sentTransmittal: row?.submitTransmittal ?? '',
    returnedAt: row?.returnedAt ?? '',
    returnTransmittal: row?.returnTransmittal ?? '',
  });`],
  [`    setDraft({
      sentAt: row?.submittedAt ?? '',
      sentTransmittal: row?.submitTransmittal ?? '',
      returnedAt: row?.returnedAt ?? '',
      returnTransmittal: row?.returnTransmittal ?? '',
      returnCode: row?.returnCode ?? '',
    });`,
   `    setDraft({
      sentAt: row?.submittedAt ?? '',
      sentTransmittal: row?.submitTransmittal ?? '',
      returnedAt: row?.returnedAt ?? '',
      returnTransmittal: row?.returnTransmittal ?? '',
    });`],
  [`      <td>
        <select defaultValue={draft.returnCode} onBlur={onBlur('returnCode')} className={field}>
          {CODES.map((c) => (
            <option key={c} value={c}>{c || '—'}</option>
          ))}
        </select>
      </td>
`, ``],
  [`  const onBlur = (key: keyof typeof draft) => (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {`,
   `  const onBlur = (key: keyof typeof draft) => (e: React.FocusEvent<HTMLInputElement>) => {`],
]);

/* the action keeps a code it is no longer told about */
patch('lib/doc-actions.ts', [
  [`  returnTransmittal: string;
  returnCode: string;
}`,
   `  returnTransmittal: string;
  /**
   * Left out by the working screen, which no longer asks for it. Undefined
   * means "leave whatever is stored alone" — an imported APP/AWC is what marks
   * a document as still out for comment, and a screen that stopped asking must
   * not quietly erase it.
   */
  returnCode?: string;
}`],
  [`    const code = input.returnCode.trim().toUpperCase() || null;`, ``],
  [`    // Anything known about the outbound leg means it went out.
    const submitted = Boolean(sentAt || sentNo || returnedAt || returnNo || code);

    db.transaction((tx) => {`,
   `    db.transaction((tx) => {`],
  [`      const existing = tx.select().from(schema.docStages)
        .where(and(eq(schema.docStages.documentId, doc.id), eq(schema.docStages.stage, stage)))
        .all()[0];

      const values = {`,
   `      const existing = tx.select().from(schema.docStages)
        .where(and(eq(schema.docStages.documentId, doc.id), eq(schema.docStages.stage, stage)))
        .all()[0];

      const code = input.returnCode === undefined
        ? existing?.returnCode ?? null
        : input.returnCode.trim().toUpperCase() || null;
      // Anything known about the outbound leg means it went out.
      const submitted = Boolean(sentAt || sentNo || returnedAt || returnNo || code);

      const values = {`],
]);
