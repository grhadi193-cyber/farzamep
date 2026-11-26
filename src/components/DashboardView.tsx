import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  AlertTriangle,
  Building2,
  Landmark,
  TrendingUp,
  ShieldAlert,
  CheckCircle2,
  ArrowUpLeft,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import {
  computeTaxComplianceExposure,
  computeTrialBalance,
} from '../lib/complianceEngine';
import { formatCurrency, formatIban, toPersianDigits, unitLabelFa } from '../lib/persian';
import { COMPANY_INFO } from '../lib/seedData';
import type { ActiveViewId } from '../types/erp';

interface DashboardViewProps {
  onNavigate: (view: ActiveViewId) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const {
    activeFiscalYear,
    accounts,
    vouchers,
    bankTransactions,
    fixedAssets,
    moadianInvoices,
    currencyUnit,
    pendingAgentDraftsCount,
  } = useFiscalYear();

  const trialBalance = useMemo(
    () => computeTrialBalance(accounts, vouchers, false),
    [accounts, vouchers]
  );

  const metrics = useMemo(() => {
    let totalAssets = 0;
    let cashAndBank = 0;
    let netSales = 0;
    let totalCogs = 0;
    let totalOpex = 0;

    for (const row of trialBalance) {
      if (row.category === 'ASSET') {
        const net = row.ending_debit_rial - row.ending_credit_rial;
        totalAssets += net;
        if (row.account_code === '1100') {
          cashAndBank = net;
        }
      }
      if (row.account_code === '7101') {
        netSales = row.ending_credit_rial - row.ending_debit_rial;
      }
      if (row.account_code === '5101') {
        totalCogs = row.ending_debit_rial - row.ending_credit_rial;
      }
      if (row.account_code === '6101' || row.account_code === '6105') {
        totalOpex += row.ending_debit_rial - row.ending_credit_rial;
      }
    }

    return { totalAssets, cashAndBank, netSales, totalCogs, totalOpex };
  }, [trialBalance]);

  const taxExposure = useMemo(
    () => computeTaxComplianceExposure(bankTransactions, fixedAssets, moadianInvoices),
    [bankTransactions, fixedAssets, moadianInvoices]
  );

  const chartData = useMemo(() => {
    const divisor = currencyUnit === 'TOMAN' ? 10 : 1;
    return [
      {
        name: 'فروش خالص (۷۱۰۱)',
        amount: Math.trunc(metrics.netSales / divisor),
        color: '#FF7A00',
      },
      {
        name: 'بهای تمام‌شده (۵۱۰۱)',
        amount: Math.trunc(metrics.totalCogs / divisor),
        color: '#94A3B8',
      },
      {
        name: 'هزینه‌های عملیاتی (۶۱۰۱/۶۱۰۵)',
        amount: Math.trunc(metrics.totalOpex / divisor),
        color: '#ED2F42',
      },
      {
        name: 'سود ناخالص',
        amount: Math.trunc(Math.max(0, metrics.netSales - metrics.totalCogs) / divisor),
        color: '#10B981',
      },
    ];
  }, [metrics, currencyUnit]);

  const quarterlyCash = useMemo(() => {
    const quarters: Array<{ key: 'Q1' | 'Q2' | 'Q3' | 'Q4'; labelFa: string }> = [
      { key: 'Q1', labelFa: 'فصل اول (بهار)' },
      { key: 'Q2', labelFa: 'فصل دوم (تابستان)' },
      { key: 'Q3', labelFa: 'فصل سوم (پاییز)' },
      { key: 'Q4', labelFa: 'فصل چهارم (زمستان)' },
    ];
    return quarters.map((q) => {
      const txs = bankTransactions.filter((t) => t.quarter === q.key);
      const deposits = txs.reduce((s, t) => s + t.deposit_rial, 0);
      const withdrawals = txs.reduce((s, t) => s + t.withdrawal_rial, 0);
      const closingBalance = txs.length > 0 ? txs[txs.length - 1].balance_rial : 0;
      const allVerified = txs.every((t) => t.continuity_verified);
      return {
        ...q,
        count: txs.length,
        deposits,
        withdrawals,
        closingBalance,
        allVerified,
      };
    });
  }, [bankTransactions]);

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-6">
      {/* Page Title & Quick Context */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#F8FAFC]">
            داشبورد مالی و انطباق مالیاتی
          </h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            {COMPANY_INFO.nameFa} · دوره مالی <span className="num-ltr font-semibold text-[#F8FAFC]">{activeFiscalYear.code}</span> · تمامی ارقام نمایشی بر حسب{' '}
            <strong className="text-[#FF7A00]">{unitFa}</strong> (ذخیره‌سازی قطعی در پایگاه داده: ریال صحیح BIGINT)
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('vouchers')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333] transition-colors hover:bg-[#ff8c24] whitespace-nowrap"
          >
            <span>میز کار اسناد حسابداری</span>
            <ArrowUpLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 4 Executive KPI Cards */}
      <section aria-label="شاخص‌های کلیدی مالی" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Total Assets */}
        <div className="rounded-xl border border-white/10 bg-[#1E3A72] p-5">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>جمع کل دارایی‌ها</span>
            <Building2 className="h-4 w-4 text-[#FF7A00]" />
          </div>
          <div className="mt-3 text-xl font-extrabold text-[#F8FAFC] num-ltr" data-testid="kpi-total-assets">
            {formatCurrency(metrics.totalAssets, currencyUnit)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#94A3B8]">
            <span>واحد: {unitFa}</span>
            <span>اسناد قطعی: {toPersianDigits(vouchers.filter((v) => v.status === 'FINALIZED').length)}</span>
          </div>
        </div>

        {/* KPI 2: Cash & Bank (1100) */}
        <div className="rounded-xl border border-white/10 bg-[#1E3A72] p-5">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>موجودی نقد و بانک (معین ۱۱۰۰)</span>
            <Landmark className="h-4 w-4 text-[#FF7A00]" />
          </div>
          <div className="mt-3 text-xl font-extrabold text-[#F8FAFC] num-ltr" data-testid="kpi-cash-bank">
            {formatCurrency(metrics.cashAndBank, currencyUnit)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#94A3B8]">
            <span>بانک اقتصاد نوین و تنخواه</span>
            <span className="text-[#10B981] font-semibold">پیوستگی تأیید شده</span>
          </div>
        </div>

        {/* KPI 3: Net Sales (7101) */}
        <div className="rounded-xl border border-white/10 bg-[#1E3A72] p-5">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>فروش خالص (معین ۷۱۰۱)</span>
            <TrendingUp className="h-4 w-4 text-[#FF7A00]" />
          </div>
          <div className="mt-3 text-xl font-extrabold text-[#F8FAFC] num-ltr" data-testid="kpi-net-sales">
            {formatCurrency(metrics.netSales, currencyUnit)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#94A3B8]">
            <span>حاشیه سود ناخالص</span>
            <span className="num-ltr font-semibold text-[#10B981]">
              {metrics.netSales > 0
                ? `${toPersianDigits(Math.round(((metrics.netSales - metrics.totalCogs) / metrics.netSales) * 100))}%`
                : '۰%'}
            </span>
          </div>
        </div>

        {/* KPI 4: Tax Compliance Exposure (#ED2F42 Alert Card) */}
        <div className="rounded-xl border border-[#ED2F42] bg-[#16284F] p-5">
          <div className="flex items-center justify-between text-xs text-[#F8FAFC]">
            <span className="font-semibold">ریسک و مخاطرات انطباق مالیاتی</span>
            <ShieldAlert className="h-4 w-4 text-[#ED2F42]" />
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-xl font-extrabold text-[#FF6B7B] num-ltr" data-testid="kpi-tax-exposure">
              {formatCurrency(taxExposure.totalExposureRial, currencyUnit)}
            </span>
            <span className="rounded bg-[#ED2F42] px-1.5 py-0.5 text-[10px] font-bold text-white">هشدار</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#F8FAFC]/85">
            <span>
              ردیف ۴۰۶:{' '}
              <strong className="num-ltr text-[#FF6B7B]">
                {formatCurrency(taxExposure.art149ExcessDepreciationRial, currencyUnit)}
              </strong>
            </span>
            <span>رد مودیان: {toPersianDigits(taxExposure.rejectedMoadianCount)}</span>
          </div>
        </div>
      </section>

      {/* Main 2-Column Analytical Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Revenue vs COGS vs OpEx BarChart */}
        <section className="xl:col-span-7 rounded-xl border border-white/10 bg-[#1E3A72] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#F8FAFC]">
                مقایسه عملکرد درآمد، بهای تمام‌شده و هزینه‌های عملیاتی
              </h2>
              <p className="text-xs text-[#94A3B8]">
                بر اساس اسناد قطعی‌شده دوره {activeFiscalYear.code} ({unitFa})
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('statements')}
              className="text-xs font-semibold text-[#FF7A00] hover:underline"
            >
              مشاهده صورت سود و زیان رسمی
            </button>
          </div>

          <div className="h-[300px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 12, right: 16, left: 16, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#F8FAFC', fontSize: 11, fontFamily: 'Peyda, Vazirmatn, sans-serif' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                  tickFormatter={(v: number) =>
                    v >= 1_000_000_000
                      ? `${(v / 1_000_000_000).toFixed(1)}B`
                      : v >= 1_000_000
                      ? `${Math.round(v / 1_000_000)}M`
                      : String(v)
                  }
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{
                    backgroundColor: '#102333',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontFamily: 'Peyda, Vazirmatn, sans-serif',
                    direction: 'rtl',
                    textAlign: 'right',
                  }}
                  formatter={(value) => [
                    `${Number(Array.isArray(value) ? value[0] : value ?? 0).toLocaleString('en-US')} ${unitFa}`,
                    'مبلغ',
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'Peyda, Vazirmatn, sans-serif' }}
                />
                <Bar dataKey="amount" name={`عملکرد دوره (${unitFa})`} fill="#FF7A00" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={`bar-${idx}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Tax Compliance Exposure Breakdown Panel */}
        <section className="xl:col-span-5 rounded-xl border border-white/10 bg-[#1E3A72] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
              <h2 className="text-base font-bold text-[#F8FAFC]">جزئیات مخاطرات انطباق مالیاتی</h2>
              <span className="text-xs font-bold text-[#ED2F42]">پایش زنده ق.م.م</span>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div className="space-y-1">
                  <div className="font-bold text-[#F8FAFC] flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#ED2F42] shrink-0" />
                    <span>مازاد استهلاک ماده ۱۴۹ (ردیف ۴۰۶ ناوگان)</span>
                  </div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    اختلاف نرخ دفتری (۲۰٪) و نرخ قانونی ردیف ۴۰۶ (۱۲٪) روی ناوگان تجاری آتی فرزام؛ مشمول برگشت هزینه در اظهارنامه عملکرد.
                  </p>
                </div>
                <span className="num-ltr shrink-0 font-bold text-[#ED2F42]">
                  {formatCurrency(taxExposure.art149ExcessDepreciationRial, currencyUnit)} {unitFa}
                </span>
              </div>

              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div className="space-y-1">
                  <div className="font-bold text-[#F8FAFC] flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#ED2F42] shrink-0" />
                    <span>برداشت‌های بانکی فاقد مستندات ماده ۱۴۷</span>
                  </div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    تعداد {toPersianDigits(taxExposure.undocumentedCount)} تراکنش خروجی بانک اقتصاد نوین بدون صورتحساب رسمی سامانه مودیان.
                  </p>
                </div>
                <span className="num-ltr shrink-0 font-bold text-[#ED2F42]">
                  {formatCurrency(taxExposure.undocumentedOutflowsRial, currencyUnit)} {unitFa}
                </span>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-bold text-[#F8FAFC] flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#ED2F42] shrink-0" />
                    <span>وضعیت صورتحساب‌های سامانه مودیان</span>
                  </div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    {toPersianDigits(taxExposure.rejectedMoadianCount)} مورد «رد شده» (نیازمند اصلاحیه) ·{' '}
                    {toPersianDigits(taxExposure.canceledMoadianCount)} مورد «باطل شده» (مستثنی‌شده از ارزش افزوده).
                  </p>
                </div>
                <span className="num-ltr shrink-0 font-bold text-[#ED2F42]">
                  {formatCurrency(taxExposure.rejectedMoadianRial, currencyUnit)} {unitFa}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3.5 text-xs">
            <span className="text-[#94A3B8]">
              پیشنویس‌های در صف تأیید Muse.ai:{' '}
              <strong className="text-[#F8FAFC]">{toPersianDigits(pendingAgentDraftsCount)} مورد</strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('agent_queue')}
              className="font-semibold text-[#FF7A00] hover:underline"
            >
              بررسی صف تأیید اسناد
            </button>
          </div>
        </section>
      </div>

      {/* Bank Eghtesad Novin Quarterly Cash Continuity Panel */}
      <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#F8FAFC]">
              پیوستگی فصلی جریان نقدی — {COMPANY_INFO.bankNameFa}
            </h2>
            <p className="mt-0.5 text-xs text-[#94A3B8]">
              شماره شبا:{' '}
              <span className="mono-ltr text-[#F8FAFC]">{formatIban(COMPANY_INFO.bankIban)}</span> · اثبات ریاضی
              پیوستگی مانده (<span className="mono-ltr">prev + dep - wd === curr</span>)
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('excel_import')}
            className="rounded-lg border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-[#F8FAFC] transition-colors hover:border-[#FF7A00] hover:text-[#FF7A00]"
          >
            ورود صورتحساب جدید (.xls)
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[#94A3B8]">
                <th className="py-2.5 px-3 font-semibold">فصل مالی</th>
                <th className="py-2.5 px-3 font-semibold">تعداد تراکنش</th>
                <th className="py-2.5 px-3 font-semibold">جمع واریزی‌ها ({unitFa})</th>
                <th className="py-2.5 px-3 font-semibold">جمع برداشت‌ها ({unitFa})</th>
                <th className="py-2.5 px-3 font-semibold">مانده پایان فصل ({unitFa})</th>
                <th className="py-2.5 px-3 font-semibold">وضعیت پیوستگی مانده</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {quarterlyCash.map((q) => (
                <tr key={q.key} className="hover:bg-white/5 transition-colors">
                  <td className="py-3 px-3 font-semibold text-[#F8FAFC]">{q.labelFa}</td>
                  <td className="py-3 px-3 num-ltr text-[#F8FAFC]">{toPersianDigits(q.count)}</td>
                  <td className="py-3 px-3 num-ltr text-[#10B981] font-medium">
                    {formatCurrency(q.deposits, currencyUnit)}
                  </td>
                  <td className="py-3 px-3 num-ltr text-[#F8FAFC]">
                    {formatCurrency(q.withdrawals, currencyUnit)}
                  </td>
                  <td className="py-3 px-3 num-ltr font-bold text-[#F8FAFC]">
                    {q.count > 0 ? formatCurrency(q.closingBalance, currencyUnit) : '—'}
                  </td>
                  <td className="py-3 px-3">
                    {q.count === 0 ? (
                      <span className="text-[#94A3B8]">بدون گردش در این فصل</span>
                    ) : q.allVerified ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#10B981]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        پیوستگی ۱۰۰٪ اثبات شد
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#ED2F42]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        دارای مغایرت مانده
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
