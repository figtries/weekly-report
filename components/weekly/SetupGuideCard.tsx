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
  tone = 'info',
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
  /**
   * `info` is something UNFINISHED, `warn` is something WRONG.
   *
   * The note above says two yellow cards read as two of the same thing, and
   * that still holds — which is why this is a deliberate switch and not a
   * free colour. A plan that has not been weighted yet is a step nobody has
   * taken; a plan whose weights do not add up to 100 is a number that is
   * already wrong, and a person should be able to tell those apart from
   * across the room.
   */
  tone?: 'info' | 'warn';
}) {
  const warn = tone === 'warn';
  return (
    <Card
      size="sm"
      className={
        warn
          ? 'animate-enter bg-warn-soft ring-warn/30'
          : 'animate-enter bg-chart-1/6 ring-chart-1/30'
      }
    >
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        </div>
        <PressLink
          {...pressMotion}
          href={href}
          className={
            warn
              ? 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-warn px-4 py-2 text-sm font-medium text-white'
              : 'inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-chart-1 px-4 py-2 text-sm font-medium text-white'
          }
        >
          {cta}
        </PressLink>
      </CardContent>
    </Card>
  );
}
