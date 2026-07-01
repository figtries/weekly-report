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
    <>
      <div className="mb-4 flex items-start justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pertamina.png"
          alt="Pertamina EP"
          style={{ width: '160px', height: '48px', objectFit: 'contain', objectPosition: 'left' }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/indoturbine.png"
          alt="Indoturbine"
          style={{ width: '140px', height: '48px', objectFit: 'contain', objectPosition: 'right' }}
        />
      </div>
      <div className="mb-4 text-center">
        <h1 className="mb-1 text-lg font-bold">{title}</h1>
        <p className="mb-1 text-sm font-semibold">{subtitle}</p>
        <p className="text-sm">{period}</p>
      </div>
    </>
  );
}
