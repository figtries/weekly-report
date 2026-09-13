import { PressLink, pressMotion } from '@/components/motion/Press';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The one thing standing between this project and a report worth trusting.
 *
 * ONE card, not a checklist. The rule this app keeps relearning is that quiet
 * content reads as absent, so the thing that is missing gets a whole card with
 * a real button on it rather than a grey line among other grey lines. And one
 * at a time, in dependency order, because there is no point weighting a plan
 * that has no rows and no point counting work nobody has scheduled.
 *
 * It renders nothing at all once the project is set up. A permanent banner is
 * furniture, and furniture is what people learn to stop seeing.
 *
 * BLUE, not the warn yellow it started as. The Fill in screen already carries a
 * yellow card for items past their finish date, and two yellow cards with a
 * button each read as two of the same thing — while one is about how the
 * project is set up and the other is about this week. Colour is the only thing
 * telling them apart before the words are read.
 */
export default function SetupGuideCard({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <Card size="sm" className="animate-enter bg-chart-1/6 ring-chart-1/30">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        </div>
        <PressLink
          {...pressMotion}
          href={href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-chart-1 px-4 py-2 text-sm font-medium text-white"
        >
          {cta}
        </PressLink>
      </CardContent>
    </Card>
  );
}
