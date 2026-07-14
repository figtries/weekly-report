// The masthead of every printed sheet: the two logos, a rule, then the title
// block. Same on all five reports — a report never rolls its own header.
export default function PrintHeader({
  title,
  subtitle,
  period,
}: {
  title: string;
  subtitle: string;
  period: string;
}) {
  return (
    <header>
      <div className="rpt-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pertamina.png" alt="Pertamina EP" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/indoturbine.png" alt="Indoturbine" />
      </div>
      <hr className="rpt-rule" />
      <div className="rpt-titleblock">
        <h1 className="rpt-title">{title}</h1>
        <p className="rpt-project">{subtitle}</p>
        <p>
          <span className="rpt-period">{period}</span>
        </p>
      </div>
    </header>
  );
}
