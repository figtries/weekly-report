/** Nothing imported yet — say which script fills it, and stop. */
export function EmptyRegister({ script, name }: { script: string; name: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h2 className="text-xl font-semibold tracking-tight">This register is empty</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Import the {name} first, then reload this page.
      </p>
      <pre className="mt-6 overflow-x-auto rounded-xl bg-gray-900 px-4 py-3 text-left text-xs text-gray-100">
        {script}
      </pre>
    </div>
  );
}
