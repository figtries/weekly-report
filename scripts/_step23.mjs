import fs from 'node:fs';

// ---- createProjectAction takes the signed value and the currency.
{
  const f = 'lib/project-actions.ts';
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(
    `  startDate: string;
  finishDate: string;
}): Promise<ProjectResult> {`,
    `  startDate: string;
  finishDate: string;
  /**
   * The SIGNED contract value. Asked here because a contract exists before a
   * single WBS row does — deriving it from prices later forced signed and
   * allocated to be equal, which deleted the gap between them.
   */
  contractValue?: number | null;
  currency?: string;
}): Promise<ProjectResult> {`
  );
  s = s.replace(
    `          updatedAt: now,
          // Weight comes from prices, and there are none yet. \`even\` is the
          // honest label until a BOQ exists — see AGENTS.md.
          weightBasis: 'even',`,
    `          updatedAt: now,
          contractValue: input.contractValue ?? null,
          currency: input.currency && isKnownCurrency(input.currency) ? input.currency : 'IDR',
          // Weight comes from prices, and there are none yet. \`even\` is the
          // honest label until a BOQ exists — see AGENTS.md.
          weightBasis: 'even',`
  );
  fs.writeFileSync(f, s);
  console.log('createProjectAction: nilai kontrak + mata uang');
}

// ---- setReportingUnitAction takes the unit's own contract value.
{
  const f = 'lib/sheet-structure.ts';
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(
    `export async function setReportingUnitAction(
  nodeId: string,
  on: boolean,
  label?: string
): Promise<StructureResult> {
  try {
    const projectId = projectOf(nodeId);
    db.update(schema.wbsNodes)
      .set({ isReportingUnit: on, unitLabel: on ? (label?.trim() || 'Unit') : null })
      .where(eq(schema.wbsNodes.id, nodeId))
      .run();`,
    `export async function setReportingUnitAction(
  nodeId: string,
  on: boolean,
  label?: string,
  /**
   * The unit's own signed value. A reporting unit is its own contract even when
   * it sits inside another — SPK-007 at 1.4.4 lives inside SPK-004's 1.4 and
   * its 842,723.72 is NOT part of 1.4's figure. Without a way to type this, the
   * check that the units add up to the contract had nothing to check.
   */
  unitValue?: number | null
): Promise<StructureResult> {
  try {
    const projectId = projectOf(nodeId);
    db.update(schema.wbsNodes)
      .set({
        isReportingUnit: on,
        unitLabel: on ? label?.trim() || 'Unit' : null,
        unitContractValue: on ? (unitValue ?? null) : null,
        // The unit's value IS its price: a unit is a contract, and a contract's
        // figure is what the money formula spends down its subtree.
        ...(on && unitValue != null ? { price: unitValue } : {}),
      })
      .where(eq(schema.wbsNodes.id, nodeId))
      .run();`
  );
  fs.writeFileSync(f, s);
  console.log('setReportingUnitAction: nilai unit');
}

// ---- The new-project dialog asks for the signed value and the currency.
{
  const f = 'components/projects/NewProjectDialog.tsx';
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(
    "import DateField from '@/components/ui/DateField';",
    "import DateField from '@/components/ui/DateField';\nimport { CURRENCIES } from '@/lib/currency';"
  );
  s = s.replace(
    `  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');`,
    `  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('IDR');`
  );
  s = s.replace(
    `    setStart('');
    setFinish('');
    setError(null);`,
    `    setStart('');
    setFinish('');
    setValue('');
    setError(null);`
  );
  s = s.replace(
    `      const res = await createProjectAction({
        name,
        clientName: client,
        startDate: start,
        finishDate: finish,
      });`,
    `      const res = await createProjectAction({
        name,
        clientName: client,
        startDate: start,
        finishDate: finish,
        contractValue: value.trim() === '' ? null : Number(value.replace(/[^0-9.]/g, '')),
        currency,
      });`
  );
  s = s.replace(
    `        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="np-start">Starts</Label>`,
    `        {/* The signed figure, asked here because the contract exists before the
            plan does. Optional: someone starting a schedule before the award
            should not be stopped at the door. */}
        <div className="grid grid-cols-[1fr_5.5rem] gap-2">
          <div className="space-y-1">
            <Label htmlFor="np-value">Contract value</Label>
            <Input
              id="np-value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Leave empty if not signed yet"
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="np-cur">Currency</Label>
            <select
              id="np-cur"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-11 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-foreground"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="np-start">Starts</Label>`
  );
  fs.writeFileSync(f, s);
  console.log('NewProjectDialog: nilai kontrak + mata uang');
}
