import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Lock,
  Calculator,
  ArrowLeft,
  ShieldAlert,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { computeTrialBalance } from '../lib/complianceEngine';
import { formatCurrency, toPersianDigits, unitLabelFa } from '../lib/persian';
import type { ActiveViewId, YearEndSimulationResult } from '../types/erp';

interface YearEndClosingViewProps {
  onNavigate: (view: ActiveViewId) => void;
}

export function YearEndClosingView({ onNavigate }: YearEndClosingViewProps) {
  const {
    fiscalYears,
    activeFiscalYear,
    isReadOnly,
    accounts,
    vouchers,
    moadianInvoices,
    fixedAssets,
    currencyUnit,
    runYearEndSimulation,
    executeYearEndClosing,
  } = useFiscalYear();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [includeDraftsInSim, setIncludeDraftsInSim] = useState<boolean>(false);
  const [simulation, setSimulation] = useState<YearEndSimulationResult | null>(null);
  const [simulating, setSimulating] = useState<boolean>(false);

  const candidateNextYears = useMemo(
    () => fiscalYears.filter((fy) => fy.id !== activeFiscalYear.id && !fy.is_closed),
    [fiscalYears, activeFiscalYear.id]
  );

  const [nextFiscalYearId, setNextFiscalYearId] = useState<string>(
    candidateNextYears.find((f) => f.code === '1405')?.id ?? candidateNextYears[0]?.id ?? ''
  );
  const [immutabilityConfirmed, setImmutabilityConfirmed] = useState<boolean>(false);
  const [executing, setExecuting] = useState<boolean>(false);
  const [execFeedback, setExecFeedback] = useState<{ ok: boolean; messageFa: string } | null>(null);

  useEffect(() => {
    setNextFiscalYearId(
      candidateNextYears.find((f) => f.code === '1405')?.id ?? candidateNextYears[0]?.id ?? ''
    );
    setSimulation(null);
    setImmutabilityConfirmed(false);
    setExecFeedback(null);
    setStep(1);
  }, [activeFiscalYear.id, candidateNextYears]);

  // Step 1 Pre-Close Audit checks
  const auditChecks = useMemo(() => {
    const openDrafts = vouchers.filter((v) => v.status === 'DRAFT');
    const tb = computeTrialBalance(accounts, vouchers, false);
    const sumDeb = tb.reduce((s, r) => s + r.ending_debit_rial, 0);
    const sumCred = tb.reduce((s, r) => s + r.ending_credit_rial, 0);
    const isTbBalanced = sumDeb === sumCred && sumDeb > 0;

    const canceledMoadian = moadianInvoices.filter((m) => m.status_fa === 'باطل شده').length;
    const rejectedMoadian = moadianInvoices.filter((m) => m.status_fa === 'رد شده').length;
    const art149Excess = fixedAssets.reduce((s, a) => s + Math.max(0, a.excess_disallowed_rial), 0);

    return {
      openDraftsCount: openDrafts.length,
      isTbBalanced,
      tbVariance: Math.abs(sumDeb - sumCred),
      canceledMoadian,
      rejectedMoadian,
      art149Excess,
    };
  }, [accounts, fixedAssets, moadianInvoices, vouchers]);

  const handleRunSimulation = async () => {
    setSimulating(true);
    const res = await runYearEndSimulation(includeDraftsInSim);
    setSimulation(res);
    setSimulating(false);
    setStep(2);
  };

  const handleExecuteClosing = async () => {
    if (isReadOnly || !immutabilityConfirmed || !nextFiscalYearId) return;
    setExecuting(true);
    setExecFeedback(null);
    const res = await executeYearEndClosing(nextFiscalYearId);
    setExecuting(false);
    setExecFeedback(res);
  };

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/10 pb-4">
        <h1 className="text-2xl font-extrabold text-[#F8FAFC]">ویزارد بستن سال مالی و صدور سند افتتاحیه</h1>
        <p className="mt-1 text-xs text-[#94A3B8]">
          عملیات پایان دوره سال مالی <span className="num-ltr font-bold text-[#F8FAFC]">{activeFiscalYear.code}</span> مطابق
          ماده ۱۰۵ ق.م.م (۲۵٪ مالیات عملکرد)، ماده ۱۴۹ (تعدیل استهلاک) و ماده ۲۳۸ قانون تجارت (۵٪ اندوخته قانونی)
        </p>
      </div>

      {/* 3-Step Horizontal Stepper */}
      <nav aria-label="مراحل بستن سال مالی" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(
          [
            { id: 1, title: '۱. حسابرسی پیش از بستن', desc: 'بررسی اسناد باز، تراز، مودیان و ماده ۱۴۹' },
            { id: 2, title: '۲. شبیه‌سازی قطعی (RPC)', desc: 'محاسبه مالیات ۲۵٪، اندوخته ۵٪ و سود انباشته' },
            { id: 3, title: '۳. انتخاب دوره مقصد و قفل نهایی', desc: 'اجرای fn_execute_year_end_closing' },
          ] as const
        ).map((s) => {
          const active = step === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`rounded-xl border p-4 text-right transition-colors ${
                active
                  ? 'border-[#FF7A00] bg-[#1E3A72]'
                  : 'border-white/10 bg-[#1E3A72]/55 hover:border-white/25'
              }`}
            >
              <div className={`text-sm font-bold ${active ? 'text-[#FF7A00]' : 'text-[#F8FAFC]'}`}>
                {s.title}
              </div>
              <div className="mt-1 text-xs text-[#94A3B8]">{s.desc}</div>
            </button>
          );
        })}
      </nav>

      {/* =================== STEP 1: PRE-CLOSE AUDIT =================== */}
      {step === 1 && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-base font-bold text-[#F8FAFC]">گام اول: چک‌لیست کنترل‌های الزامی پیش از بستن دوره</h2>
            <span className="text-xs text-[#94A3B8]">سال مالی {activeFiscalYear.code}</span>
          </div>

          <div className="space-y-3 text-xs">
            {/* Check 1: Zero Open Drafts */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#102333]/80 p-4">
              <div className="flex items-start gap-3">
                {auditChecks.openDraftsCount === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-[#10B981] shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-[#ED2F42] shrink-0" />
                )}
                <div>
                  <div className="font-bold text-[#F8FAFC]">عدم وجود سند پیشنویس باز (Zero Open Drafts)</div>
                  <p className="mt-0.5 text-[#94A3B8]">
                    {auditChecks.openDraftsCount === 0
                      ? 'تمامی اسناد دوره قطعی‌سازی یا تعیین تکلیف شده‌اند.'
                      : `تعداد ${toPersianDigits(auditChecks.openDraftsCount)} سند در وضعیت DRAFT (از جمله پیشنویس‌های Muse.ai) وجود دارد. پیش از اجرای نهایی بستن دوره باید قطعی یا رد شوند.`}
                  </p>
                </div>
              </div>
              {auditChecks.openDraftsCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('agent_queue')}
                  className="rounded-lg border border-[#FF7A00] px-3 py-1.5 font-bold text-[#FF7A00] hover:bg-[#FF7A00]/15"
                >
                  رفتن به صف تأیید Muse.ai
                </button>
              )}
            </div>

            {/* Check 2: Balanced Trial Balance */}
            <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#102333]/80 p-4">
              {auditChecks.isTbBalanced ? (
                <CheckCircle2 className="h-5 w-5 text-[#10B981] shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-[#ED2F42] shrink-0" />
              )}
              <div>
                <div className="font-bold text-[#F8FAFC]">تراز بودن کامل دفتر کل و تراز آزمایشی (Balanced TB)</div>
                <p className="mt-0.5 text-[#94A3B8]">
                  {auditChecks.isTbBalanced
                    ? 'جمع مانده بدهکار و بستانکار تمامی حساب‌های معین دقیقاً برابر است (اختلاف ۰ ریال).'
                    : `تراز آزمایشی دارای عدم تعادل یا بدون گردش قطعی است (اختلاف: ${formatCurrency(auditChecks.tbVariance, currencyUnit)} ${unitFa}).`}
                </p>
              </div>
            </div>

            {/* Check 3: Moadian Cancellation & Rejection Check */}
            <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#102333]/80 p-4">
              {auditChecks.rejectedMoadian === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-[#10B981] shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-[#FF7A00] shrink-0" />
              )}
              <div>
                <div className="font-bold text-[#F8FAFC]">کنترل صورتحساب‌های باطل‌شده و ردشده سامانه مودیان</div>
                <p className="mt-0.5 text-[#94A3B8]">
                  {toPersianDigits(auditChecks.canceledMoadian)} صورتحساب «باطل شده» به‌صورت خودکار مستثنی شده و{' '}
                  <strong className={auditChecks.rejectedMoadian > 0 ? 'text-[#ED2F42]' : 'text-[#10B981]'}>
                    {toPersianDigits(auditChecks.rejectedMoadian)} صورتحساب «رد شده»
                  </strong>{' '}
                  جهت تطبیق کارپوشه ثبت شده است.
                </p>
              </div>
            </div>

            {/* Check 4: Art. 149 Excess Depreciation Review */}
            <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#102333]/80 p-4">
              <ShieldAlert className="h-5 w-5 text-[#FF7A00] shrink-0" />
              <div>
                <div className="font-bold text-[#F8FAFC]">تعدیل مازاد استهلاک ماده ۱۴۹ ق.م.م (ردیف ۴۰۶)</div>
                <p className="mt-0.5 text-[#94A3B8]">
                  مبلغ{' '}
                  <strong className="num-ltr text-[#ED2F42]">
                    {formatCurrency(auditChecks.art149Excess, currencyUnit)} {unitFa}
                  </strong>{' '}
                  مازاد استهلاک دفتری نسبت به نرخ مصوب ردیف ۴۰۶ در شبیه‌سازی مالیات عملکرد ماده ۱۰۵ به درآمد مشمول مالیات اضافه می‌شود.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4">
            <label className="inline-flex items-center gap-2 text-xs text-[#F8FAFC] cursor-pointer">
              <input
                type="checkbox"
                checked={includeDraftsInSim}
                onChange={(e) => setIncludeDraftsInSim(e.target.checked)}
                className="h-4 w-4 rounded accent-[#FF7A00]"
              />
              <span>لحاظ کردن اسناد پیشنویس (DRAFT) در شبیه‌سازی گام دوم</span>
            </label>

            <button
              type="button"
              onClick={handleRunSimulation}
              disabled={simulating}
              className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-5 py-2.5 text-xs font-bold text-[#102333] hover:bg-[#ff8c24]"
            >
              <Calculator className="h-4 w-4" />
              <span>{simulating ? 'در حال شبیه‌سازی...' : 'اجرای شبیه‌سازی قطعی (fn_simulate_year_end_closing)'}</span>
            </button>
          </div>
        </section>
      )}

      {/* =================== STEP 2: DETERMINISTIC SIMULATION =================== */}
      {step === 2 && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-6 space-y-5" data-testid="year-end-simulation-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h2 className="text-base font-bold text-[#F8FAFC]">
                گام دوم: نتیجه شبیه‌سازی بستن حساب‌های موقت و تقسیم سود قانونی
              </h2>
              <p className="text-xs text-[#94A3B8]">
                خروجی قطعی <span className="mono-ltr">fn_simulate_year_end_closing</span> بر حسب {unitFa}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunSimulation}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] hover:border-[#FF7A00]"
            >
              بازمحاسبه شبیه‌سازی
            </button>
          </div>

          {!simulation ? (
            <div className="py-10 text-center">
              <button
                type="button"
                onClick={handleRunSimulation}
                className="rounded-lg bg-[#FF7A00] px-5 py-2.5 text-xs font-bold text-[#102333]"
              >
                اجرای شبیه‌سازی سال مالی {activeFiscalYear.code}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                <div className="rounded-lg border border-white/10 bg-[#102333]/80 p-3.5">
                  <div className="text-[#94A3B8]">جمع درآمدها (۷۱۰۱/۷۱۰۵)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#F8FAFC]">
                    {formatCurrency(simulation.total_revenue_rial, currencyUnit)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#102333]/80 p-3.5">
                  <div className="text-[#94A3B8]">بهای تمام‌شده (۵۱۰۱)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#F8FAFC]">
                    {formatCurrency(simulation.total_cogs_rial, currencyUnit)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#102333]/80 p-3.5">
                  <div className="text-[#94A3B8]">هزینه‌های عملیاتی (۶۱۰۱/۶۱۰۵)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#F8FAFC]">
                    {formatCurrency(simulation.total_opex_rial, currencyUnit)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#102333]/80 p-3.5">
                  <div className="text-[#94A3B8]">سود قبل از مالیات (دفتری)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#10B981]">
                    {formatCurrency(simulation.pre_tax_profit_rial, currencyUnit)}
                  </div>
                </div>

                <div className="rounded-lg border border-[#ED2F42]/50 bg-[#102333]/80 p-3.5">
                  <div className="text-[#ED2F42] font-semibold">هزینه غیرقابل‌قبول ماده ۱۴۹ + درآمد مشمول</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#F8FAFC]">
                    {formatCurrency(simulation.taxable_income_rial, currencyUnit)}
                  </div>
                  <div className="mt-1 text-[11px] text-[#94A3B8]">
                    مازاد ۱۴۹: <span className="num-ltr">{formatCurrency(simulation.disallowed_expenses_rial, currencyUnit)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-[#FF7A00]/50 bg-[#102333]/80 p-3.5">
                  <div className="text-[#FF7A00] font-semibold">ذخیره ۲۵٪ مالیات ماده ۱۰۵ (معین ۲۱۰۶)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#F8FAFC]">
                    {formatCurrency(simulation.income_tax_25pct_rial, currencyUnit)}
                  </div>
                </div>

                <div className="rounded-lg border border-[#10B981]/50 bg-[#102333]/80 p-3.5">
                  <div className="text-[#10B981] font-semibold">سود خالص و ۵٪ اندوخته ماده ۲۳۸ (۳۱۰۵)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#F8FAFC]">
                    {formatCurrency(simulation.net_profit_rial, currencyUnit)}
                  </div>
                  <div className="mt-1 text-[11px] text-[#94A3B8]">
                    اندوخته قانونی ۵٪: <span className="num-ltr">{formatCurrency(simulation.statutory_reserve_5pct_rial, currencyUnit)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-white/15 bg-[#102333]/80 p-3.5">
                  <div className="text-[#94A3B8]">انتقال به سود انباشته (معین ۳۱۰۴)</div>
                  <div className="mt-1.5 num-ltr text-base font-extrabold text-[#10B981]">
                    {formatCurrency(simulation.retained_earnings_transfer_rial, currencyUnit)}
                  </div>
                </div>
              </div>

              {/* Preview Closing Voucher Lines */}
              <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#102333]/80">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#94A3B8]">
                      <th className="p-2.5">کد معین</th>
                      <th className="p-2.5">عنوان حساب</th>
                      <th className="p-2.5">شرح آرتیکل اختتامیه</th>
                      <th className="p-2.5">بدهکار ({unitFa})</th>
                      <th className="p-2.5">بستانکار ({unitFa})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {simulation.closing_lines_preview.map((l, idx) => (
                      <tr key={idx}>
                        <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{l.account_code}</td>
                        <td className="p-2.5 font-semibold text-[#F8FAFC]">{l.account_name_fa}</td>
                        <td className="p-2.5 text-[#94A3B8]">{l.note_fa}</td>
                        <td className="p-2.5 num-ltr text-[#F8FAFC]">
                          {l.debit_rial > 0 ? formatCurrency(l.debit_rial, currencyUnit) : '—'}
                        </td>
                        <td className="p-2.5 num-ltr text-[#F8FAFC]">
                          {l.credit_rial > 0 ? formatCurrency(l.credit_rial, currencyUnit) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-5 py-2.5 text-xs font-bold text-[#102333] hover:bg-[#ff8c24]"
                >
                  <span>ادامه به گام سوم (انتخاب دوره مقصد و قفل نهایی)</span>
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* =================== STEP 3: NEXT-YEAR SELECTION & EXECUTION =================== */}
      {step === 3 && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-6 space-y-5">
          <h2 className="text-base font-bold text-[#F8FAFC] border-b border-white/10 pb-3">
            گام سوم: انتخاب سال مالی مقصد، تأیید برگشت‌ناپذیری و اجرای قطعی بستن سال مالی
          </h2>

          {isReadOnly ? (
            <div className="flex items-center gap-3 rounded-lg border border-[#ED2F42] bg-[#ED2F42]/20 p-4 text-xs font-bold text-white">
              <Lock className="h-5 w-5 shrink-0" />
              <span>سال مالی {activeFiscalYear.code} بسته و قفل شده است و امکان اجرای مجدد ندارد.</span>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div>
                <label htmlFor="next-fy-select" className="mb-1.5 block font-bold text-[#F8FAFC]">
                  سال مالی مقصد جهت صدور خودکار سند افتتاحیه (Opening Balance Transfer):
                </label>
                <select
                  id="next-fy-select"
                  value={nextFiscalYearId}
                  onChange={(e) => setNextFiscalYearId(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-white/15 bg-[#102333] px-3.5 py-2.5 text-xs font-bold text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                >
                  {candidateNextYears.map((fy) => (
                    <option key={fy.id} value={fy.id} className="bg-[#102333]">
                      {fy.code} — {fy.title_fa} ({fy.jalali_start} تا {fy.jalali_end})
                    </option>
                  ))}
                </select>
              </div>

              {auditChecks.openDraftsCount > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[#ED2F42]/60 bg-[#ED2F42]/15 p-3.5 text-[#F8FAFC]">
                  <span>
                    مانع اجرایی: تعداد {toPersianDigits(auditChecks.openDraftsCount)} سند پیشنویس باز وجود دارد.
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('agent_queue')}
                    className="font-bold text-[#FF7A00] underline"
                  >
                    بررسی و قطعی‌سازی
                  </button>
                </div>
              )}

              <label className="flex items-start gap-3 rounded-lg border border-[#ED2F42]/40 bg-[#102333]/80 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={immutabilityConfirmed}
                  onChange={(e) => setImmutabilityConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-[#ED2F42]"
                />
                <span className="leading-relaxed text-[#F8FAFC]">
                  به‌عنوان مدیر مالی مجاز بازرگانی توسعه تجارت آتی فرزام ایرانیان تأیید می‌کنم که اجرای{' '}
                  <span className="mono-ltr font-bold text-[#FF7A00]">fn_execute_year_end_closing</span> موجب صدور سند
                  اختتامیه، انتقال مانده حساب‌های دائمی به سال مقصد و <strong>قفل دائمی و برگشت‌ناپذیر</strong> سال مالی{' '}
                  {activeFiscalYear.code} خواهد شد.
                </span>
              </label>

              {execFeedback && (
                <div
                  className={`flex items-center gap-2 rounded-lg border p-3.5 font-semibold ${
                    execFeedback.ok
                      ? 'border-[#10B981]/60 bg-[#10B981]/15 text-[#F8FAFC]'
                      : 'border-[#ED2F42]/60 bg-[#ED2F42]/15 text-[#F8FAFC]'
                  }`}
                >
                  {execFeedback.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-[#ED2F42]" />
                  )}
                  <span>{execFeedback.messageFa}</span>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={
                    isReadOnly ||
                    !immutabilityConfirmed ||
                    !nextFiscalYearId ||
                    auditChecks.openDraftsCount > 0 ||
                    executing
                  }
                  onClick={handleExecuteClosing}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#ED2F42] px-6 py-2.5 text-xs font-bold text-white hover:bg-[#d72436] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Lock className="h-4 w-4" />
                  <span>{executing ? 'در حال بستن سال مالی...' : 'اجرای قطعی بستن سال مالی و قفل دوره'}</span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
