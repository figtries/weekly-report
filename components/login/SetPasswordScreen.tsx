'use client';

import { Check, CircleAlert, Eye, EyeOff, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useId, useRef, useState, type FormEvent } from 'react';

import { useBareScreen } from '@/components/layout/use-bare-screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createBrowserClient } from '@supabase/ssr';
import { cn } from '@/lib/utils';

const MIN = 8;

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function SetPasswordScreen() {
  useBareScreen();
  return (
    <div data-login className="login-mesh relative isolate flex min-h-[calc(100dvh/var(--z))] items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="login-blob -left-[14%] -top-[20%] size-[46rem] bg-[#c5dbfe]/70" />
        <div className="login-blob -right-[12%] -top-[18%] size-[26rem] bg-[#0077ff]/25" />
      </div>
      <SetPasswordCard />
    </div>
  );
}

function SetPasswordCard() {
  const pwdId = useId();
  const confirmId = useId();
  const pwdRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<{ pwd?: string; confirm?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'done'>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (phase !== 'idle') return;

    const next = {
      pwd: !pwd ? 'Enter a password.' : pwd.length < MIN ? `Use at least ${MIN} characters.` : undefined,
      confirm: !confirm ? 'Confirm your password.' : pwd !== confirm ? 'Passwords do not match.' : undefined,
    };
    setErrors(next);
    if (next.pwd) return pwdRef.current?.focus();
    if (next.confirm) return confirmRef.current?.focus();

    setPhase('saving');
    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) {
      setProblem(error.message);
      setPhase('idle');
      return;
    }
    setPhase('done');
    window.setTimeout(() => window.location.assign('/'), 600);
  }

  return (
    <div className="animate-enter w-full max-w-[440px] rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_28px_64px_-32px_rgba(20,60,140,0.4)] sm:p-9">
      <div className="mb-6 flex items-center gap-2.5">
        <Image src="/lucille-mark-on-light.png" alt="" width={20} height={34} className="h-8 w-auto" priority />
        <span className="text-lg font-semibold tracking-tight text-foreground">Lucille</span>
      </div>

      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Set your password</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose a password to sign in with from now on.</p>

      {problem && (
        <div className="animate-fade-in-up mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{problem}</p>
        </div>
      )}

      <form noValidate onSubmit={submit} className="mt-6 space-y-5">
        <div>
          <label htmlFor={pwdId} className="text-sm font-medium text-foreground">New password</label>
          <div className="relative">
            <Input
              ref={pwdRef}
              id={pwdId}
              type={showPwd ? 'text' : 'password'}
              autoComplete="new-password"
              value={pwd}
              onChange={(e) => { setPwd(e.target.value); setErrors((v) => ({ ...v, pwd: undefined })); }}
              aria-invalid={errors.pwd ? true : undefined}
              className={cn(FIELD, 'pr-12')}
            />
            <ToggleShow show={showPwd} onToggle={() => setShowPwd((v) => !v)} controls={pwdId} />
          </div>
          {errors.pwd && <FieldError>{errors.pwd}</FieldError>}
        </div>

        <div>
          <label htmlFor={confirmId} className="text-sm font-medium text-foreground">Confirm password</label>
          <div className="relative">
            <Input
              ref={confirmRef}
              id={confirmId}
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setErrors((v) => ({ ...v, confirm: undefined })); }}
              aria-invalid={errors.confirm ? true : undefined}
              className={cn(FIELD, 'pr-12')}
            />
            <ToggleShow show={showConfirm} onToggle={() => setShowConfirm((v) => !v)} controls={confirmId} />
          </div>
          {errors.confirm && <FieldError>{errors.confirm}</FieldError>}
        </div>

        <Button
          type="submit"
          aria-disabled={phase !== 'idle' || undefined}
          className="h-11 w-full text-[0.9375rem] font-semibold"
        >
          {phase === 'saving' ? (
            <><Loader2 className="animate-spin" aria-hidden />Saving…</>
          ) : phase === 'done' ? (
            <><Check aria-hidden />Password set</>
          ) : (
            'Set password'
          )}
        </Button>
      </form>
    </div>
  );
}

const FIELD = 'mt-1.5 h-11 bg-card px-3.5 md:text-[0.9375rem] focus-visible:border-primary focus-visible:ring-primary/20';

function ToggleShow({ show, onToggle, controls }: { show: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      aria-label={show ? 'Hide password' : 'Show password'}
      aria-controls={controls}
      onClick={onToggle}
      className="absolute right-0 top-1.5 grid size-11 place-items-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:text-primary focus-visible:ring-3 focus-visible:ring-primary/25"
    >
      {show ? <EyeOff className="size-[1.125rem]" /> : <Eye className="size-[1.125rem]" />}
    </button>
  );
}

function FieldError({ children }: { children: string }) {
  return (
    <p role="alert" className="animate-fade-in-up mt-1.5 flex items-center gap-1.5 text-sm text-red-700">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}
