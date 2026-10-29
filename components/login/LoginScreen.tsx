'use client';

import { Check, CircleAlert, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';

import { DashboardIcon, DataOverallIcon, ProjectsIcon } from '@/components/layout/NavIcons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { findAccount, passwordOf, signIn } from '@/lib/signed-in';
import { cn } from '@/lib/utils';

// ponytail: demo login (board item 22 brings real login). The email must be an
// account on Roles, the password is the one the Master set there, and all of it
// is checked in this browser (`lib/signed-in.ts`).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Problem = null | 'wrong' | 'suspended';
type Phase = 'idle' | 'checking' | 'done';

export function LoginScreen() {
  return (
    <div data-login className="login-mesh relative isolate min-h-[calc(100dvh/var(--z))] overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="login-blob -left-[14%] -top-[20%] size-[46rem] bg-[#c5dbfe]/70" />
        <div className="login-blob left-[16%] top-[50%] size-[30rem] bg-[#00d0d4]/20" />
        <div className="login-blob -right-[12%] -top-[18%] size-[26rem] bg-[#0077ff]/25" />
      </div>

      {/* One screen on desktop: the showcase takes whatever height is left, never more. */}
      <div className="mx-auto grid min-h-[calc(100dvh/var(--z))] w-full max-w-[1680px] grid-rows-[auto_1fr_auto] lg:h-[calc(100dvh/var(--z))] lg:grid-cols-[minmax(0,1fr)_minmax(28rem,34rem)] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col px-5 pt-6 sm:px-8 sm:pt-8 lg:px-12 lg:py-8 xl:px-16">
          <div className="flex items-center gap-2.5">
            <Image src="/lucille-mark-on-light.png" alt="" width={20} height={34} className="h-10 w-auto drop-shadow-[0_0_0.75px_rgba(29,78,216,0.55)] drop-shadow-[0_6px_12px_rgba(29,78,216,0.28)]" priority />
            <span className="text-xl font-semibold tracking-tight text-foreground">Lucille</span>
          </div>

          <div className="animate-enter mt-8 flex min-h-0 flex-1 flex-col lg:mt-[4vh]">
            <h1 className="text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-5xl xl:text-[3.75rem]">
              Precision that fits
              <br />
              <span className="text-primary">in your pocket.</span>
            </h1>
            <Showcase className="animate-enter stagger-2 mb-6 mt-10 hidden lg:block" />
          </div>

          <Footer className="hidden lg:flex" />
        </section>

        <section className="flex items-start justify-center px-4 pb-8 pt-7 sm:px-8 lg:items-center lg:py-8">
          <SignInCard />
        </section>

        <Footer className="flex px-5 pb-8 sm:px-8 lg:hidden" />
      </div>
    </div>
  );
}

function SignInCard() {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const forgotId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [problem, setProblem] = useState<Problem>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (phase !== 'idle') return;
    const typed = email.trim();
    const next = {
      email: !typed ? 'Enter your email.' : !EMAIL.test(typed) ? 'This is not an email address. Check for a typo.' : undefined,
      password: !password ? 'Enter your password.' : undefined,
    };
    setErrors(next);
    setProblem(null);
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();

    setPhase('checking');
    window.setTimeout(() => {
      const account = findAccount(typed);
      const refused: Problem =
        !account || password !== passwordOf(account) ? 'wrong' : account.status === 'suspended' ? 'suspended' : null;
      if (refused) {
        setProblem(refused);
        setPhase('idle');
        if (refused === 'wrong') passwordRef.current?.select();
        return;
      }
      setPhase('done');
      signIn(account!);
      window.setTimeout(() => router.push('/'), 700);
    }, 900);
  }

  function edit(field: 'email' | 'password', value: string) {
    if (field === 'email') setEmail(value);
    else setPassword(value);
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (problem) setProblem(null);
  }

  return (
    <div className="animate-enter stagger-1 w-full max-w-[440px] rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_28px_64px_-32px_rgba(20,60,140,0.4)] sm:p-9">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
      <p className="mt-1 text-sm text-muted-foreground">Use the account your Master gave you.</p>

      <div aria-live="polite">
        {problem && (
          <div
            className={cn(
              'animate-fade-in-up mt-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
              problem === 'wrong' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900',
            )}
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {problem === 'wrong'
                ? 'Email or password is incorrect.'
                : 'This account is suspended. Contact your Master.'}
            </p>
          </div>
        )}
      </div>

      <form noValidate onSubmit={submit} className="mt-6 space-y-5">
        <div>
          <label htmlFor={emailId} className="text-sm font-medium text-foreground">
            Email
          </label>
          <Input
            ref={emailRef}
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="name@company.com"
            value={email}
            onChange={(e) => edit('email', e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? `${emailId}-error` : undefined}
            className={FIELD}
          />
          {errors.email && <FieldError id={`${emailId}-error`}>{errors.email}</FieldError>}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={passwordId} className="text-sm font-medium text-foreground">
              Password
            </label>
            <button
              type="button"
              aria-expanded={forgot}
              aria-controls={forgotId}
              onClick={() => setForgot((v) => !v)}
              className="-mx-1 -my-2.5 rounded-md px-1 py-2.5 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-primary/25"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              ref={passwordRef}
              id={passwordId}
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => edit('password', e.target.value)}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? `${passwordId}-error` : undefined}
              className={cn(FIELD, 'pr-12')}
            />
            <button
              type="button"
              aria-label={show ? 'Hide password' : 'Show password'}
              aria-controls={passwordId}
              onClick={() => setShow((v) => !v)}
              className="absolute right-0 top-1.5 grid size-11 place-items-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:text-primary focus-visible:ring-3 focus-visible:ring-primary/25"
            >
              {show ? <EyeOff className="size-[1.125rem]" /> : <Eye className="size-[1.125rem]" />}
            </button>
          </div>
          {errors.password && <FieldError id={`${passwordId}-error`}>{errors.password}</FieldError>}
          <div id={forgotId} hidden={!forgot}>
            <div className="animate-fade-in-up mt-3 flex items-start gap-2.5 rounded-xl bg-primary-soft px-3.5 py-3 text-sm text-primary">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>Your Master resets passwords. Ask them for a new one, then sign in here.</p>
            </div>
          </div>
        </div>

        <Button
          type="submit"
          aria-disabled={phase !== 'idle' || undefined}
          className="h-11 w-full text-[0.9375rem] font-semibold"
        >
          {phase === 'checking' ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Signing in…
            </>
          ) : phase === 'done' ? (
            <>
              <Check aria-hidden />
              Signed in
            </>
          ) : (
            'Sign in'
          )}
        </Button>
      </form>
      <span className="sr-only" aria-live="polite">
        {phase === 'checking' ? 'Signing in' : phase === 'done' ? 'Signed in. Opening the Dashboard.' : ''}
      </span>

      <p className="mt-6 text-center text-sm leading-relaxed text-muted-foreground">
        No account yet? Access is given by your Master. Contact them to get invited.
      </p>
    </div>
  );
}

const FIELD =
  'mt-1.5 h-11 bg-card px-3.5 md:text-[0.9375rem] focus-visible:border-primary focus-visible:ring-primary/20';

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="animate-fade-in-up mt-1.5 flex items-center gap-1.5 text-sm text-red-700">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function Footer({ className }: { className?: string }) {
  const [note, setNote] = useState<null | 'terms' | 'contact'>(null);
  const link =
    'rounded-md py-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-primary/25';
  return (
    <footer className={cn('flex-col gap-1', className)}>
      <div className="flex gap-5">
        <button type="button" aria-expanded={note === 'terms'} onClick={() => setNote(note === 'terms' ? null : 'terms')} className={link}>
          Terms
        </button>
        <button type="button" aria-expanded={note === 'contact'} onClick={() => setNote(note === 'contact' ? null : 'contact')} className={link}>
          Contact Master
        </button>
      </div>
      <p aria-live="polite" className="min-h-5 max-w-md text-sm text-muted-foreground">
        {note === 'terms' && 'For invited accounts only. What each account can open is set by the Master.'}
        {note === 'contact' && 'Ask whoever manages Roles in Lucille. They invite accounts and reset passwords.'}
      </p>
    </footer>
  );
}


// Real screens of the demo project, captured from the app (public/login/*).
// Rename a file when re-capturing: next/image caches by URL.
function Showcase({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('relative min-h-0 flex-1 [container-type:size]', className)}>
      <div className="absolute left-0 top-1/2 aspect-[16/9] w-[min(100cqw,calc(100cqh*16/9))] -translate-y-1/2">
        {/* Stacked, so the dashboard always starts just under the Gantt's late row. */}
        <div className="absolute inset-y-0 right-0 flex w-[66%] flex-col">
          <Frame src="/login/gantt-late.webp" w={720} h={392} icon={ProjectsIcon} label="Plan" note="Links and delays" className="mr-[3%]" />
          <Frame src="/login/dash-progress.webp" w={962} h={341} icon={DashboardIcon} label="Dashboard" note="Progress this week" className="-mt-3 ml-auto w-[68%]" />
        </div>
        <div className="absolute bottom-0 left-0 h-[80%]">
          <Tag icon={DataOverallIcon} className="absolute bottom-full left-1/2 mb-3 -translate-x-1/2">
            Update from site
          </Tag>
          <div className="h-full rounded-[2.25rem] bg-neutral-900 p-2 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.6)]">
            <div className="h-full overflow-hidden rounded-[1.75rem] bg-white">
              <Image src="/login/phone-panel.webp" alt="" width={780} height={1474} sizes="320px" className="h-full w-auto" priority />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type Icon = typeof DashboardIcon;

function Frame({
  src,
  w,
  h,
  icon: I,
  label,
  note,
  className,
}: {
  src: string;
  w: number;
  h: number;
  icon: Icon;
  label: string;
  note: string;
  className: string;
}) {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06),0_32px_64px_-28px_rgba(20,60,140,0.55)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <span className="grid size-5 place-items-center rounded-md bg-primary-soft text-primary">
          <I className="scale-[0.72] text-primary" />
        </span>
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className="ml-auto text-[0.6875rem] text-muted-foreground">{note}</span>
      </div>
      <Image src={src} alt="" width={w * 2} height={h * 2} sizes="900px" className="block h-auto w-full" priority />
    </div>
  );
}

function Tag({ icon: I, className, children }: { icon: Icon; className?: string; children: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-black/5 bg-white/90 py-1 pl-1 pr-3 text-xs font-semibold text-foreground shadow-[0_8px_20px_-10px_rgba(20,60,140,0.5)]',
        className,
      )}
    >
      <span className="grid size-5 place-items-center rounded-full bg-primary-soft text-primary">
        <I className="scale-[0.72] text-primary" />
      </span>
      {children}
    </span>
  );
}
