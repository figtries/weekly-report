'use client';

import { Check, CircleAlert, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ponytail: demo only, nothing is checked (board item 22 brings real login).
// Typing one of these two addresses shows its refusal; anything else that is
// an email with 8+ characters of password gets in.
const DEMO = { wrong: 'wrong@lucille.app', suspended: 'suspended@lucille.app' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Problem = null | 'wrong' | 'suspended';
type Phase = 'idle' | 'checking' | 'done';

export function LoginScreen() {
  return (
    <div data-login className="login-mesh relative isolate min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="login-blob -left-[14%] -top-[20%] size-[46rem] bg-[#c5dbfe]/70" />
        <div className="login-blob left-[16%] top-[50%] size-[30rem] bg-[#00d0d4]/20" />
        <div className="login-blob -right-[12%] -top-[18%] size-[26rem] bg-[#0077ff]/25" />
      </div>

      <div className="mx-auto grid min-h-dvh w-full max-w-[1600px] grid-rows-[auto_1fr_auto] lg:grid-cols-[11fr_9fr] lg:grid-rows-1">
        <section className="flex flex-col px-5 pt-6 sm:px-8 sm:pt-8 lg:px-14 lg:py-12 xl:px-20">
          <div className="flex items-center gap-2.5">
            {/* On a white tile: the mark's pale half is the gradient's own colour. */}
            <span className="grid size-12 place-items-center rounded-xl bg-white/90 shadow-[0_6px_16px_-8px_rgba(20,60,140,0.35)]">
              <Image src="/lucille-mark.png" alt="" width={20} height={34} className="h-8 w-auto" priority />
            </span>
            <span className="text-xl font-semibold tracking-tight text-foreground">Lucille</span>
          </div>

          <div className="animate-enter mt-8 lg:my-auto lg:py-10">
            <h1 className="max-w-[16ch] text-[1.75rem] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-4xl xl:text-[2.75rem]">
              Project control for EPC work.
            </h1>
            <p className="mt-3 max-w-md text-base text-muted-foreground sm:text-lg">
              Track every project against plan, week by week.
            </p>
            <CurveCard className="animate-enter stagger-2 mt-10 hidden lg:block" />
          </div>

          <Footer className="hidden lg:flex" />
        </section>

        <section className="flex items-start justify-center px-4 pb-8 pt-7 sm:px-8 lg:items-center lg:py-12">
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
      const who = typed.toLowerCase();
      const refused: Problem =
        who === DEMO.suspended ? 'suspended' : who === DEMO.wrong || password.length < 8 ? 'wrong' : null;
      if (refused) {
        setProblem(refused);
        setPhase('idle');
        if (refused === 'wrong') passwordRef.current?.select();
        return;
      }
      setPhase('done');
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

// The decoration's figures come from its own curve, so they add up on a calculator.
const WEEKS = 60;
const NOW = 36;
const ease = (t: number) => t * t * (3 - 2 * t);
const planAt = (w: number) => ease(w / WEEKS);
const actualAt = (w: number) => ease(Math.min(1, (w + 1.6) / WEEKS));
const y = (v: number) => 40 - v * 38;
const points = (f: (w: number) => number, to: number) =>
  Array.from({ length: to + 1 }, (_, w) => `${((w / WEEKS) * 100).toFixed(2)},${y(f(w)).toFixed(2)}`).join(' ');
const r2 = (n: number) => Math.round(n * 100) / 100;
const PLAN = r2(planAt(NOW) * 100);
const ACTUAL = r2(actualAt(NOW) * 100);
const AHEAD = r2(ACTUAL - PLAN);
const NOW_X = (NOW / WEEKS) * 100;

function CurveCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'max-w-md rounded-2xl border border-white/80 bg-white/65 p-5 shadow-[0_24px_56px_-32px_rgba(20,60,140,0.5)] backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Overall progress</p>
        <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">Week {NOW}</span>
      </div>
      <div className="mt-3 flex gap-7">
        <Figure label="Actual" value={`${ACTUAL.toFixed(2)}%`} dot="#3b82f6" />
        <Figure label="Plan" value={`${PLAN.toFixed(2)}%`} dot="#ef4444" />
        <Figure label="Ahead" value={`+${AHEAD.toFixed(2)}%`} />
      </div>
      <div className="relative mt-4 h-28">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <defs>
            <linearGradient id="login-actual-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3b82f6" stopOpacity="0.22" />
              <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[10, 20, 30].map((g) => (
            <line key={g} x1="0" x2="100" y1={g} y2={g} stroke="#e5e7eb" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <polygon points={`0,40 ${points(actualAt, NOW)} ${NOW_X},40`} fill="url(#login-actual-fill)" />
          <polyline points={points(planAt, WEEKS)} fill="none" stroke="#ef4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <polyline
            points={points(actualAt, NOW)}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#3b82f6] shadow"
          style={{ left: `${NOW_X}%`, top: `${(y(actualAt(NOW)) / 40) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[0.6875rem] text-muted-foreground">
        <span>Start</span>
        <span>Finish</span>
      </div>
    </div>
  );
}

function Figure({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
        {label}
      </p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
