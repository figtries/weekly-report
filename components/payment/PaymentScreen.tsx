'use client';

/*
 * Payment: the last step of the Master's first-time setup, before the app.
 *
 * FRONT-END PROTOTYPE, THE PAYMENT IS SIMULATED. Nothing here talks to a
 * gateway and nothing typed leaves the browser. In production the card fields
 * MUST be the payment gateway's hosted fields (or a redirect to its page), so
 * raw card data never touches Lucille's own server; the VA number and the
 * receiving account come from the gateway, never from Math.random.
 *
 * Logos are the companies' own files, supplied by hand into public/logos/:
 *   bca.svg  mandiri.svg  bni.svg  bri.svg  permata.svg  cimb-niaga.svg
 *   visa.svg  mastercard.svg  jcb.svg
 * A missing file falls back to an outlined box with the name.
 *
 * Preview the unhappy endings with ?outcome=failed or ?outcome=expired
 * (expired also runs a virtual account's countdown out in 10 seconds).
 */

import { Check, ChevronDown, CircleAlert, Clock, Copy, CreditCard, Download, FileUp, Info, Loader2, Lock, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PPN_RATE = 0.11; // PPN; change here and every figure follows.
const LINES = [
  { label: 'Lucille Enterprise, 12 months', note: 'Unlimited projects and accounts', amount: 10_000_000 },
  { label: 'Onboarding and data import', note: 'One-off, your first project set up with you', amount: 2_500_000 },
];
const SUBTOTAL = LINES.reduce((s, l) => s + l.amount, 0);
const PPN = Math.round(SUBTOTAL * PPN_RATE);
const TOTAL = SUBTOTAL + PPN;
const WHAT_YOU_GET = [
  'Every project, week by week against plan',
  'Weekly and daily reports in your client’s Excel format',
  'Document control for EDL and VDRL',
  'Accounts for your whole team, access set per person',
];

// Placeholders until login and billing exist (board item 22).
const MASTER_EMAIL = 'master@company.co.id';
const SUPPORT_EMAIL = 'support@lucille.app';
const COMPANY_ACCOUNT = { bank: 'mandiri', bankName: 'Bank Mandiri', number: '000 0000 0000', holder: 'PT Nama Perusahaan' };

const BANKS = [
  { id: 'bca', name: 'BCA', prefix: '39358', mobile: 'BCA mobile', web: 'KlikBCA' },
  { id: 'mandiri', name: 'Mandiri', prefix: '89508', mobile: 'Livin’ by Mandiri', web: 'Mandiri Internet Banking' },
  { id: 'bni', name: 'BNI', prefix: '8808', mobile: 'BNI Mobile Banking', web: 'BNI Internet Banking' },
  { id: 'bri', name: 'BRI', prefix: '26215', mobile: 'BRImo', web: 'BRI Internet Banking' },
  { id: 'permata', name: 'Permata', prefix: '8528', mobile: 'PermataMobile X', web: 'PermataNet' },
  { id: 'cimb-niaga', name: 'CIMB Niaga', prefix: '5919', mobile: 'OCTO Mobile', web: 'OCTO Clicks' },
] as const;
type Bank = (typeof BANKS)[number];

const METHODS = [
  {
    id: 'va',
    title: 'Bank transfer (Virtual Account)',
    desc: 'Pay from any of six banks. Confirmed automatically.',
    badge: 'Recommended',
    logos: BANKS.slice(0, 3),
  },
  {
    id: 'manual',
    title: 'Manual bank transfer',
    desc: 'For corporate finance teams. Verified within 1 business day.',
    logos: [{ id: COMPANY_ACCOUNT.bank, name: COMPANY_ACCOUNT.bankName }],
  },
  {
    id: 'card',
    title: 'Credit or debit card',
    desc: 'Visa, Mastercard or JCB. Your bank may ask for an OTP.',
    logos: [
      { id: 'visa', name: 'Visa' },
      { id: 'mastercard', name: 'Mastercard' },
      { id: 'jcb', name: 'JCB' },
    ],
  },
] as const;
type MethodId = (typeof METHODS)[number]['id'];
type Phase = 'choose' | 'awaiting' | 'processing' | 'success' | 'failed' | 'expired';
type CardForm = { name: string; number: string; expiry: string; cvv: string };
type Problems = Partial<Record<'bank' | 'proof' | keyof CardForm, string>>;

const rupiah = (n: number) => `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;
const when = (t: number) =>
  new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const grouped = (s: string) => s.replace(/(.{4})(?!$)/g, '$1 ');
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const outcome = () => new URLSearchParams(window.location.search).get('outcome');

const BRAND_NAME = { visa: 'Visa', mastercard: 'Mastercard', jcb: 'JCB' } as const;
type Brand = keyof typeof BRAND_NAME;

function brandOf(d: string): Brand | null {
  const n4 = Number(d.slice(0, 4));
  if (d.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(d) || (d.length >= 4 && n4 >= 2221 && n4 <= 2720)) return 'mastercard';
  if (d.length >= 4 && n4 >= 3528 && n4 <= 3589) return 'jcb';
  return null;
}

function luhn(d: string) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2) x = x * 2 > 9 ? x * 2 - 9 : x * 2;
    sum += x;
  }
  return sum % 10 === 0;
}

function checkCard(c: CardForm): Problems {
  const p: Problems = {};
  const d = c.number.replace(/\D/g, '');
  if (!c.name.trim()) p.name = 'Enter the name on the card.';
  if (!d) p.number = 'Enter the card number.';
  else if (d.length >= 4 && !brandOf(d)) p.number = 'Use a Visa, Mastercard or JCB card.';
  else if (d.length < 16 || !luhn(d)) p.number = 'This card number is not valid. Check for a typo.';
  const [mm, yy] = c.expiry.split('/').map(Number);
  if (c.expiry.length < 5 || !(mm >= 1 && mm <= 12)) p.expiry = 'Enter the expiry as MM/YY.';
  // The card is good through the last day of its month.
  else if (new Date(2000 + yy, mm, 1) <= new Date()) p.expiry = 'This card has expired.';
  if (c.cvv.length !== 3) p.cvv = 'Enter the 3-digit code on the back.';
  return p;
}

export function PaymentScreen() {
  const router = useRouter();
  const ids = useId();
  const [method, setMethod] = useState<MethodId>('va');
  const [bankId, setBankId] = useState<Bank['id'] | null>(null);
  const [card, setCard] = useState<CardForm>({ name: '', number: '', expiry: '', cvv: '' });
  const [proof, setProof] = useState<File | null>(null);
  const [proofTooBig, setProofTooBig] = useState(false);
  const [reference, setReference] = useState('');
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<Phase>('choose');
  const [va, setVa] = useState<{ number: string; deadline: number } | null>(null);
  const [now, setNow] = useState(0);
  const [receipt, setReceipt] = useState<{ ref: string; paidAt: number } | null>(null);

  const bank = BANKS.find((b) => b.id === bankId) ?? null;
  const digitsOnly = card.number.replace(/\D/g, '');
  const brand = brandOf(digitsOnly);
  const problems: Problems =
    method === 'va'
      ? bank ? {} : { bank: 'Choose the bank you will pay from.' }
      : method === 'manual'
        ? proof ? {} : { proof: 'Upload the transfer receipt first.' }
        : checkCard(card);
  const ready = Object.keys(problems).length === 0;
  // Validate on action: nothing speaks until Pay is pressed. Errors shown on
  // blur pushed the Pay button down between mousedown and click, so the press
  // that left a short CVV never landed (measured 28 Oct 2026).
  const show = (k: keyof Problems) => (tried ? problems[k] : undefined);

  const methodLabel =
    method === 'va'
      ? `Virtual Account · ${bank?.name ?? ''}`
      : method === 'manual'
        ? `Manual transfer · ${COMPANY_ACCOUNT.bankName}`
        : `${brand ? BRAND_NAME[brand] : 'Card'} ending ${digitsOnly.slice(-4)}`;
  const payLabel = method === 'manual' ? `Submit transfer of ${rupiah(TOTAL)}` : `Pay ${rupiah(TOTAL)}`;

  useEffect(() => {
    if (phase !== 'awaiting' || !va) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= va.deadline) setPhase('expired');
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase, va]);

  function chooseMethod(id: MethodId) {
    setMethod(id);
    setTried(false);
    if (id === 'manual' && !reference) setReference(`LCL-${digits(4)}-${digits(4)}`);
  }

  function pay() {
    if (!ready) {
      setTried(true);
      const first = Object.keys(problems)[0];
      document.getElementById(`${ids}-${first}`)?.focus();
      return;
    }
    setConfirming(true);
  }

  function start() {
    setConfirming(false);
    const t = Date.now();
    setNow(t);
    if (method === 'va' && bank) {
      const deadline = t + (outcome() === 'expired' ? 10_000 : 24 * 3_600_000);
      setVa({ number: bank.prefix + digits(16 - bank.prefix.length), deadline });
      setPhase('awaiting');
    } else if (method === 'manual') setPhase('awaiting');
    else process();
  }

  function process() {
    setPhase('processing');
    window.setTimeout(() => {
      const o = outcome();
      if (o === 'failed' || o === 'expired') return setPhase(o);
      setReceipt({ ref: method === 'manual' ? reference : `LCL-${digits(4)}-${digits(4)}`, paidAt: Date.now() });
      setPhase('success');
    }, 1800);
  }

  function chooseAnother() {
    setPhase('choose');
    setVa(null);
    setTried(false);
  }

  function retry() {
    if (method === 'card') process();
    else start();
  }

  function downloadInvoice() {
    if (!receipt) return;
    const row = (a: string, b: string) => `${a.padEnd(34)}${b}`;
    const text = [
      'LUCILLE · INVOICE',
      '',
      row('Reference', receipt.ref),
      row('Paid on', when(receipt.paidAt)),
      row('Billed to', MASTER_EMAIL),
      row('Method', methodLabel),
      '',
      ...LINES.map((l) => row(l.label, rupiah(l.amount))),
      row('Subtotal', rupiah(SUBTOTAL)),
      row(`PPN ${PPN_RATE * 100}%`, rupiah(PPN)),
      row('Total paid', rupiah(TOTAL)),
    ].join('\n');
    // ponytail: plain text; the real invoice is the billing system's PDF.
    // Saved the way SavePdfButton saves: a detached anchor, or an early revoke, cancels it.
    const href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = `Lucille invoice ${receipt.ref}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  }

  const status: Record<Phase, string> = {
    choose: '',
    awaiting: method === 'va' ? 'Awaiting transfer.' : 'Proof received. Awaiting verification.',
    processing: 'Processing payment.',
    success: 'Payment received.',
    failed: 'Payment failed. No money was taken.',
    expired: 'Payment window expired. No money was taken.',
  };

  return (
    <div data-checkout className="flex min-h-[calc(100dvh/var(--z))] flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card">
        <div className={cn(WRAP, 'flex h-16 items-center justify-between gap-4')}>
          <div className="flex items-center gap-2.5">
            <Image src="/lucille-mark.png" alt="" width={20} height={34} className="h-7 w-auto" priority />
            <span className="text-lg font-semibold tracking-tight text-foreground">Lucille</span>
          </div>
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <span className="hidden truncate text-sm text-muted-foreground sm:block">
              Signed in as <span className="font-medium text-foreground">{MASTER_EMAIL}</span>
            </span>
            <Link href="/login" className={cn(LINK, 'px-2 py-3')}>
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <div className="checkout-band border-b border-border/60">
        <div className={cn(WRAP, 'py-4 sm:py-5')}>
          <Stepper paid={phase === 'success'} />
        </div>
      </div>

      <div className={cn(WRAP, 'grid flex-1 items-start gap-6 py-6 sm:py-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10 lg:py-10')}>
        <aside aria-label="Order summary" className="animate-enter lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
          <Summary paid={phase === 'success'} />
        </aside>

        {/* Not <main>: the root layout's <main> already holds this page. */}
        <div className="animate-enter stagger-1 min-w-0 lg:col-start-1 lg:row-start-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">Payment</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Lucille opens for your team as soon as the payment is confirmed.
          </p>
          <span className="sr-only" aria-live="polite">
            {status[phase]}
          </span>

          {phase === 'choose' && (
            <>
              <fieldset className="mt-6">
                <legend className="sr-only">Payment method</legend>
                <div className="space-y-3">
                  {METHODS.map((m) => (
                    <MethodCard key={m.id} method={m} selected={method === m.id} onSelect={() => chooseMethod(m.id)}>
                      {m.id === 'va' && (
                        <BankPicker
                          id={`${ids}-bank`}
                          value={bankId}
                          onChange={(b) => setBankId(b)}
                          error={show('bank')}
                        />
                      )}
                      {m.id === 'manual' && (
                        <ManualDetails
                          id={`${ids}-proof`}
                          reference={reference}
                          proof={proof}
                          tooBig={proofTooBig}
                          error={show('proof')}
                          onProof={(f) => {
                            setProofTooBig(!!f && f.size > 10 * 1024 * 1024);
                            setProof(f && f.size <= 10 * 1024 * 1024 ? f : null);
                          }}
                        />
                      )}
                      {m.id === 'card' && (
                        <CardFields
                          ids={ids}
                          card={card}
                          brand={brand}
                          errors={{ name: show('name'), number: show('number'), expiry: show('expiry'), cvv: show('cvv') }}
                          onChange={(k, v) => setCard((c) => ({ ...c, [k]: v }))}
                        />
                      )}
                    </MethodCard>
                  ))}
                </div>
              </fieldset>

              <div className="mt-6 space-y-3">
                <SecureStrip />
                <Button
                  onClick={pay}
                  aria-disabled={!ready || undefined}
                  className={cn('h-12 w-full text-base font-semibold', !ready && 'opacity-55 hover:shadow-sm')}
                >
                  <Lock className="size-4" aria-hidden />
                  {payLabel}
                </Button>
              </div>
            </>
          )}

          {phase === 'awaiting' && method === 'va' && va && bank && (
            <StatePanel tone="amber" pill="Awaiting transfer" title={`Transfer to your ${bank.name} virtual account`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Clock className="size-5 self-center text-amber-600" aria-hidden />
                <span className="font-mono text-2xl font-semibold tabular-nums text-amber-700" role="timer" aria-label="Time left to pay">
                  {countdown(va.deadline - now)}
                </span>
                <span className="text-sm text-muted-foreground">left · pay before {when(va.deadline)}</span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <CopyRow label="Virtual account number" value={grouped(va.number)} copy={va.number} mono />
                <CopyRow label="Amount" value={rupiah(TOTAL)} copy={String(TOTAL)} note="Transfer this exact amount." />
              </div>
              <Instructions bank={bank} va={grouped(va.number)} />
              <Actions>
                <Button onClick={process} className="h-11 px-5 font-semibold">
                  Check payment status
                </Button>
                <Button variant="outline" onClick={chooseAnother} className="h-11 px-5">
                  Choose another method
                </Button>
              </Actions>
              <p className="mt-3 text-sm text-muted-foreground">The bank confirms within minutes of your transfer.</p>
            </StatePanel>
          )}

          {phase === 'awaiting' && method === 'manual' && (
            <StatePanel tone="amber" pill="Awaiting verification" title="Proof of transfer received">
              <p className="text-sm text-muted-foreground sm:text-base">
                Our finance team matches your transfer to its reference. This takes up to 1 business day, and Lucille opens
                as soon as it is confirmed.
              </p>
              <Facts
                rows={[
                  ['Reference', <span key="r" className="font-mono text-sm">{reference}</span>],
                  ['Amount', rupiah(TOTAL)],
                  ['Proof', proof?.name ?? ''],
                ]}
              />
              <Actions>
                <Button onClick={process} className="h-11 px-5 font-semibold">
                  Check status
                </Button>
                <Button variant="outline" onClick={chooseAnother} className="h-11 px-5">
                  Choose another method
                </Button>
              </Actions>
            </StatePanel>
          )}

          {phase === 'processing' && (
            <StatePanel tone="blue" icon={<Loader2 className="size-6 animate-spin" aria-hidden />} title="Processing payment">
              <p className="text-sm text-muted-foreground sm:text-base">
                {method === 'card'
                  ? 'Your bank may ask for a one-time code (3-D Secure) to confirm. Keep this page open.'
                  : 'Checking with the bank. Keep this page open.'}
              </p>
            </StatePanel>
          )}

          {phase === 'success' && receipt && (
            <StatePanel tone="green" icon={<Check className="size-6" aria-hidden />} pill="Paid" title="Payment received">
              <p className="text-sm text-muted-foreground sm:text-base">Your Lucille workspace is ready.</p>
              <Facts
                rows={[
                  ['Reference', <span key="r" className="font-mono text-sm">{receipt.ref}</span>],
                  ['Amount', <span key="a" className="font-semibold">{rupiah(TOTAL)}</span>],
                  ['Method', methodLabel],
                  ['Paid on', when(receipt.paidAt)],
                ]}
              />
              <Actions>
                <Button onClick={() => router.push('/')} className="h-12 px-6 text-base font-semibold">
                  Continue to Lucille
                </Button>
                <Button variant="outline" onClick={downloadInvoice} className="h-12 px-5">
                  <Download aria-hidden />
                  Download invoice
                </Button>
              </Actions>
            </StatePanel>
          )}

          {(phase === 'failed' || phase === 'expired') && (
            <StatePanel
              tone="red"
              icon={<X className="size-6" aria-hidden />}
              pill={phase === 'failed' ? 'Failed' : 'Expired'}
              title={phase === 'failed' ? 'Payment failed' : 'Payment window expired'}
            >
              <p className="text-sm text-muted-foreground sm:text-base">
                {phase === 'failed'
                  ? 'The bank declined the payment. No money was taken.'
                  : method === 'va'
                    ? 'The virtual account expired before a transfer arrived. No money was taken.'
                    : 'The payment session timed out. No money was taken.'}
              </p>
              <Actions>
                <Button onClick={retry} className="h-11 px-5 font-semibold">
                  Try again
                </Button>
                <Button variant="outline" onClick={chooseAnother} className="h-11 px-5">
                  Choose another method
                </Button>
              </Actions>
            </StatePanel>
          )}
        </div>
      </div>

      <Footer />

      <ConfirmDialog
        open={confirming}
        title="Confirm payment"
        destructive={false}
        confirmLabel={method === 'manual' ? 'Submit' : 'Pay now'}
        onCancel={() => setConfirming(false)}
        onConfirm={start}
        message={
          <div className="mt-3 rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
            <p className="text-sm text-muted-foreground">{methodLabel}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{rupiah(TOTAL)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Lucille Enterprise, 12 months, PPN included</p>
          </div>
        }
      />
    </div>
  );
}

const WRAP = 'mx-auto w-full max-w-[1360px] px-4 sm:px-8 lg:px-12';
const LINK =
  'rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-primary/25';
const FIELD =
  'mt-1.5 h-11 bg-card px-3.5 md:text-[0.9375rem] focus-visible:border-primary focus-visible:ring-primary/20';

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
}

const STEPS = ['Sign in', 'Payment', 'Start using Lucille'];

function Stepper({ paid }: { paid: boolean }) {
  const stateOf = (i: number) =>
    i === 0 || (i === 1 && paid) ? 'done' : i === 1 || paid ? 'current' : 'locked';
  return (
    <ol aria-label="Setup" className="flex items-center gap-2 sm:gap-3">
      {STEPS.map((label, i) => {
        const s = stateOf(i);
        return (
          <li key={label} aria-current={s === 'current' ? 'step' : undefined} className="relative flex min-w-0 items-center gap-2 sm:gap-3">
            {i > 0 && <span aria-hidden className={cn('h-px w-5 shrink-0 sm:w-12', s === 'locked' ? 'bg-border' : 'bg-primary/50')} />}
            <span
              aria-hidden
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                s === 'done' && 'bg-primary text-primary-foreground',
                s === 'current' && 'bg-card text-primary ring-2 ring-primary',
                s === 'locked' && 'bg-card/70 text-muted-foreground ring-1 ring-border',
              )}
            >
              {s === 'done' ? <Check className="size-3.5" /> : s === 'locked' ? <Lock className="size-3" /> : i + 1}
            </span>
            <span className={cn('truncate text-sm', s === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground max-sm:sr-only')}>
              {label}
              <span className="sr-only">
                {s === 'done' ? ', done' : s === 'locked' ? ', opens once the payment is confirmed' : ', current step'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Summary({ paid }: { paid: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04),0_24px_56px_-36px_rgba(20,60,140,0.35)]">
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Order summary</h2>
          {paid && <Pill tone="green">Paid</Pill>}
        </div>
        <div className="mt-3 flex items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft">
            <Image src="/lucille-mark.png" alt="" width={20} height={34} className="h-7 w-auto" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">Lucille Enterprise</p>
            <p className="text-sm text-muted-foreground">Billed yearly · 12 months from the day of payment</p>
          </div>
        </div>
        <dl className="mt-5 space-y-3 border-t border-border/70 pt-4 text-sm">
          {LINES.map((l) => (
            <div key={l.label} className="flex justify-between gap-4">
              <dt>
                <span className="text-foreground">{l.label}</span>
                <span className="block text-xs text-muted-foreground">{l.note}</span>
              </dt>
              <dd className="shrink-0 tabular-nums text-foreground">{rupiah(l.amount)}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-4 space-y-2 border-t border-border/70 pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums text-foreground">{rupiah(SUBTOTAL)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">PPN {PPN_RATE * 100}%</dt>
            <dd className="tabular-nums text-foreground">{rupiah(PPN)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-t border-border/70 pt-4">
          <span className="text-sm font-medium text-foreground">{paid ? 'Total paid' : 'Total due'}</span>
          <span className="text-[1.875rem] font-bold leading-none tracking-tight tabular-nums text-foreground">{rupiah(TOTAL)}</span>
        </div>
      </div>
      <div className="border-t border-border/70 bg-muted/35 px-5 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-foreground">What you get</h3>
        <ul className="mt-2.5 space-y-2 text-sm text-foreground">
          {WHAT_YOU_GET.map((w) => (
            <li key={w} className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      </div>
      <p className="flex items-center gap-2 border-t border-border/70 px-5 py-3.5 text-xs text-muted-foreground sm:px-6">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        Secured payment, encrypted from your browser to the gateway.
      </p>
    </div>
  );
}

function MethodCard({
  method,
  selected,
  onSelect,
  children,
}: {
  method: (typeof METHODS)[number];
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-card transition-[border-color,box-shadow] duration-200',
        selected ? 'border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_14%,transparent)]' : 'border-border hover:border-foreground/25',
      )}
    >
      <label
        className={cn(
          'relative flex cursor-pointer flex-wrap items-start gap-x-3.5 gap-y-2.5 rounded-2xl p-4 sm:flex-nowrap sm:items-center sm:p-5',
          selected && 'rounded-b-none bg-primary-soft/70',
        )}
      >
        <input type="radio" name="method" value={method.id} checked={selected} onChange={onSelect} className="peer sr-only" />
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors sm:mt-0 peer-focus-visible:ring-3 peer-focus-visible:ring-primary/30',
            selected ? 'border-primary' : 'border-muted-foreground/45',
          )}
        >
          {selected && <span className="size-2.5 rounded-full bg-primary" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-foreground">{method.title}</span>
            {'badge' in method && <Pill tone="blue">{method.badge}</Pill>}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{method.desc}</span>
        </span>
        <span className="flex basis-full flex-wrap items-center gap-1.5 pl-[2.125rem] sm:basis-auto sm:flex-nowrap sm:pl-0">
          {method.logos.map((l) => (
            <Logo key={l.id} id={l.id} name={l.name} />
          ))}
          {method.id === 'va' && <span className="px-1 text-xs font-medium text-muted-foreground">+3</span>}
        </span>
      </label>
      {selected && <div className="animate-fade-in-up border-t border-primary/20 p-4 sm:p-5">{children}</div>}
    </div>
  );
}

function BankPicker({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: Bank['id'] | null;
  onChange: (b: Bank['id']) => void;
  error?: string;
}) {
  const bank = BANKS.find((b) => b.id === value);
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-sm font-medium text-foreground">Choose your bank</legend>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {BANKS.map((b, i) => {
          const on = value === b.id;
          return (
            <label
              key={b.id}
              className={cn(
                'relative flex h-16 cursor-pointer items-center justify-center rounded-xl border bg-white px-3 transition-[border-color,box-shadow] duration-200 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30',
                on ? 'border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_14%,transparent)]' : 'border-border hover:border-foreground/30',
                error && !on && 'border-red-300',
              )}
            >
              <input
                id={i === 0 ? id : undefined}
                type="radio"
                name="bank"
                value={b.id}
                checked={on}
                onChange={() => onChange(b.id)}
                className="sr-only"
              />
              <Logo id={b.id} name={b.name} className="h-8 border-0 px-0" />
              {on && (
                <span aria-hidden className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      {bank && (
        <p className="animate-fade-in-up mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          You get a {bank.name} virtual account number after you press Pay. It stays valid for 24 hours.
        </p>
      )}
    </fieldset>
  );
}

function ManualDetails({
  id,
  reference,
  proof,
  tooBig,
  error,
  onProof,
}: {
  id: string;
  reference: string;
  proof: File | null;
  tooBig: boolean;
  error?: string;
  onProof: (f: File | null) => void;
}) {
  const problem = tooBig ? 'This file is over 10 MB. Upload a smaller copy.' : error;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Transfer to this account</p>
        <Pill tone="amber">
          <Clock className="size-3" aria-hidden />
          Verified within 1 business day
        </Pill>
      </div>
      <dl className="mt-3 divide-y divide-border/70 rounded-xl border border-border/70 text-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-muted-foreground">Bank</dt>
          <dd className="flex items-center gap-2 font-medium text-foreground">
            <Logo id={COMPANY_ACCOUNT.bank} name={COMPANY_ACCOUNT.bankName} />
            {COMPANY_ACCOUNT.bankName}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <dt className="text-muted-foreground">Account holder</dt>
          <dd className="text-right font-medium text-foreground">{COMPANY_ACCOUNT.holder}</dd>
        </div>
      </dl>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <CopyRow label="Account number" value={COMPANY_ACCOUNT.number} copy={COMPANY_ACCOUNT.number.replace(/\s/g, '')} mono />
        <CopyRow label="Amount" value={rupiah(TOTAL)} copy={String(TOTAL)} note="Transfer this exact amount." />
        <CopyRow
          label="Reference"
          value={reference}
          copy={reference}
          mono
          note="Write this in the transfer note so we can match it."
          className="sm:col-span-2"
        />
      </div>

      <p className="mt-5 text-sm font-medium text-foreground">Upload proof of transfer</p>
      {proof ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Check className="size-4 shrink-0 text-emerald-700" aria-hidden />
            <span className="truncate text-sm font-medium text-emerald-900">{proof.name}</span>
            <span className="shrink-0 text-xs text-emerald-800/80">{(proof.size / 1024 / 1024).toFixed(1)} MB</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onProof(null)} className="h-9 shrink-0">
            Remove
          </Button>
        </div>
      ) : (
        <label
          className={cn(
            'relative mt-2 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30',
            problem ? 'border-red-300 bg-red-50/40' : 'border-border hover:border-primary/50 hover:bg-primary-soft/40',
          )}
        >
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => onProof(e.target.files?.[0] ?? null)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-error` : undefined}
            className="sr-only"
          />
          <FileUp className="size-5 text-primary" aria-hidden />
          <span className="text-sm font-medium text-primary">Choose a file</span>
          <span className="text-xs text-muted-foreground">The bank’s receipt or a screenshot. JPG, PNG or PDF, up to 10 MB.</span>
        </label>
      )}
      {problem && <FieldError id={`${id}-error`}>{problem}</FieldError>}
    </div>
  );
}

function CardFields({
  ids,
  card,
  brand,
  errors,
  onChange,
}: {
  ids: string;
  card: CardForm;
  brand: Brand | null;
  errors: Partial<Record<keyof CardForm, string>>;
  onChange: (k: keyof CardForm, v: string) => void;
}) {
  const props = (k: keyof CardForm) => ({
    id: `${ids}-${k}`,
    value: card[k],
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${ids}-${k}-error` : undefined,
  });
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Field id={`${ids}-name`} label="Name on card" error={errors.name} className="col-span-2 sm:col-span-1">
          <Input
            {...props('name')}
            autoComplete="cc-name"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="As printed on the card"
            onChange={(e) => onChange('name', e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field id={`${ids}-number`} label="Card number" error={errors.number} className="col-span-2 sm:col-span-1 sm:row-start-2">
          <div className="relative">
            <Input
              {...props('number')}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 1234 1234 1234"
              onChange={(e) => onChange('number', e.target.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '))}
              className={cn(FIELD, 'pl-[4.75rem] font-mono tracking-wide')}
            />
            {/* A fixed slot, so a wide brand tile never touches the digits. */}
            <span className="pointer-events-none absolute left-2 top-1.5 flex h-11 w-16 items-center justify-center">
              {brand ? (
                <Logo id={brand} name={BRAND_NAME[brand]} className="h-7 w-full px-1" />
              ) : (
                <CreditCard className="size-5 text-muted-foreground" aria-hidden />
              )}
            </span>
          </div>
        </Field>
        <Field id={`${ids}-expiry`} label="Expiry" error={errors.expiry} className="sm:col-start-2 sm:row-start-1">
          <Input
            {...props('expiry')}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, '').slice(0, 4);
              onChange('expiry', d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
            }}
            className={cn(FIELD, 'font-mono')}
          />
        </Field>
        <Field id={`${ids}-cvv`} label="CVV" error={errors.cvv} className="sm:col-start-2 sm:row-start-2">
          <Input
            {...props('cvv')}
            type="password"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="•••"
            onChange={(e) => onChange('cvv', e.target.value.replace(/\D/g, '').slice(0, 3))}
            className={cn(FIELD, 'font-mono')}
          />
        </Field>
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        Your bank may ask for a one-time code (3-D Secure) to confirm the payment.
      </p>
    </div>
  );
}

function Instructions({ bank, va }: { bank: Bank; va: string }) {
  const amount = rupiah(TOTAL);
  const check = `Check that the name reads Lucille and the amount is ${amount}, then confirm`;
  const ways: [string, string[]][] = [
    [
      'ATM',
      [
        `Insert your ${bank.name} card and enter your PIN.`,
        'Choose Other transactions, then Transfer, then Virtual Account.',
        `Enter ${va}.`,
        `${check}.`,
        'Keep the receipt.',
      ],
    ],
    [
      'Mobile banking',
      [`Sign in to ${bank.mobile}.`, 'Open Transfer, then Virtual Account.', `Enter ${va}.`, `${check} with your PIN.`],
    ],
    [
      'Internet banking',
      [`Sign in to ${bank.web}.`, 'Open Transfer, then Virtual Account.', `Enter ${va}.`, `${check} with your token or OTP.`],
    ],
  ];
  return (
    <div className="mt-5">
      <h3 className="text-sm font-medium text-foreground">How to pay with {bank.name}</h3>
      <div className="mt-2 divide-y divide-border/70 rounded-xl border border-border/70 bg-card">
        {ways.map(([title, steps], i) => (
          <details key={title} name="va-steps" open={i === 1} className="group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
              {title}
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <ol className="list-decimal space-y-1.5 pb-4 pl-9 pr-4 text-sm text-muted-foreground marker:text-foreground/60">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </div>
  );
}

function SecureStrip() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
        <Lock className="size-4" aria-hidden />
      </span>
      <div className="text-sm">
        <p className="font-medium text-foreground">Payments are processed by a licensed Indonesian payment gateway.</p>
        <p className="text-muted-foreground">Lucille never stores your card details.</p>
      </div>
    </div>
  );
}

const TONE = {
  amber: { ring: 'border-amber-200', icon: 'bg-amber-50 text-amber-700', pill: 'border-amber-200 bg-amber-50 text-amber-800' },
  blue: { ring: 'border-border/70', icon: 'bg-primary-soft text-primary', pill: 'border-primary/20 bg-primary-soft text-primary' },
  green: { ring: 'border-emerald-200', icon: 'bg-emerald-50 text-emerald-700', pill: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  red: { ring: 'border-red-200', icon: 'bg-red-50 text-red-700', pill: 'border-red-200 bg-red-50 text-red-800' },
};
type Tone = keyof typeof TONE;

function StatePanel({
  tone,
  icon,
  pill,
  title,
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  pill?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('animate-enter mt-6 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-7', TONE[tone].ring)}>
      <div className="flex items-start gap-4">
        {icon && <span className={cn('grid size-12 shrink-0 place-items-center rounded-full', TONE[tone].icon)}>{icon}</span>}
        <div className="min-w-0">
          {pill && <Pill tone={tone}>{pill}</Pill>}
          {/* Focused on arrival so a screen reader lands on the new state. */}
          <h2
            tabIndex={-1}
            ref={(el) => {
              el?.focus();
            }}
            className={cn('text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl', pill && 'mt-2')}
          >
            {title}
          </h2>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold', TONE[tone].pill)}>
      {children}
    </span>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-5 divide-y divide-border/70 rounded-xl border border-border/70 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">{children}</div>;
}

function CopyRow({
  label,
  value,
  copy,
  mono,
  note,
  className,
}: {
  label: string;
  value: string;
  copy: string;
  mono?: boolean;
  note?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function press() {
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard refused (an insecure origin or an old browser): the value stays selectable.
    }
  }
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3', className)}>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('mt-0.5 select-all truncate font-semibold tabular-nums text-foreground', mono ? 'font-mono text-base tracking-wide' : 'text-lg')}>
          {value}
        </p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      <Button variant="outline" onClick={press} aria-label={`Copy ${label.toLowerCase()}`} className="h-10 shrink-0 px-3">
        {copied ? <Check className="text-emerald-600" aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  );
}

function Logo({ id, name, className }: { id: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn('inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-white px-1.5', className)}>
      {broken ? (
        // The tile is the outlined box; a border here drew a box inside a box.
        <span className="whitespace-nowrap px-0.5 text-xs font-semibold leading-none text-muted-foreground">
          {name}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- the companies' own SVGs, served untouched
        <img
          src={`/logos/${id}.svg`}
          alt={name}
          className="h-full max-w-[84px] object-contain py-1"
          // decode() rejects for a missing file even when the error fired before hydration.
          ref={(el) => {
            el?.decode().catch(() => setBroken(true));
          }}
        />
      )}
    </span>
  );
}

function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="animate-fade-in-up mt-1.5 flex items-center gap-1.5 text-sm text-red-700">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function Footer() {
  const [note, setNote] = useState<null | 'terms' | 'privacy'>(null);
  const toggle = (n: 'terms' | 'privacy') => setNote(note === n ? null : n);
  return (
    <footer className="border-t border-border/60">
      <div className={cn(WRAP, 'flex flex-col gap-1 py-5')}>
        <div className="flex flex-wrap items-center gap-x-5">
          <button type="button" aria-expanded={note === 'terms'} onClick={() => toggle('terms')} className={cn(LINK, 'py-2')}>
            Terms
          </button>
          <button type="button" aria-expanded={note === 'privacy'} onClick={() => toggle('privacy')} className={cn(LINK, 'py-2')}>
            Privacy
          </button>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={cn(LINK, 'py-2 sm:ml-auto')}>
            Need help? Contact support
          </a>
        </div>
        <p aria-live="polite" className="min-h-5 max-w-xl text-sm text-muted-foreground">
          {note === 'terms' && 'Billed yearly in advance. The plan renews each year unless cancelled 30 days before it ends.'}
          {note === 'privacy' && 'Card details go to the payment gateway only. Lucille keeps the reference, amount and date.'}
        </p>
      </div>
    </footer>
  );
}
