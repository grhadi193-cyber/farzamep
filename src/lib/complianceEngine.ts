import type {
  Account,
  BankTransaction,
  ComplianceIssue,
  FixedAsset,
  MoadianInvoice,
  TrialBalanceRow,
  Voucher,
  VoucherLine,
  YearEndSimulationResult,
} from '../types/erp';
import { normalizePersianText } from './persian';

export interface VoucherBalanceSummary {
  totalDebitRial: number;
  totalCreditRial: number;
  varianceRial: number;
  isBalanced: boolean;
  hasValidLines: boolean;
}

/**
 * Pure integer double-entry balance calculator.
 */
export function computeVoucherBalance(
  lines: Array<Pick<VoucherLine, 'debit_rial' | 'credit_rial'>>
): VoucherBalanceSummary {
  let totalDebitRial = 0;
  let totalCreditRial = 0;
  let nonZeroCount = 0;

  for (const line of lines) {
    const d = Math.trunc(line.debit_rial || 0);
    const c = Math.trunc(line.credit_rial || 0);
    totalDebitRial += d;
    totalCreditRial += c;
    if (d > 0 || c > 0) nonZeroCount += 1;
  }

  const varianceRial = totalDebitRial - totalCreditRial;
  return {
    totalDebitRial,
    totalCreditRial,
    varianceRial,
    isBalanced: varianceRial === 0 && totalDebitRial > 0,
    hasValidLines: nonZeroCount >= 2,
  };
}

/**
 * Inline Iranian Direct Tax Act & Accounting Standards Pre-Check for Vouchers:
 * - Double-entry variance check
 * - Art. 147 (ماده ۱۴۷ ق.م.م): Acceptable expenses must have documentary Moadian / invoice reference
 * - Art. 86 (ماده ۸۶ ق.م.م): Payroll expenses require withholding tax / SSO accrual on 2104
 * - Art. 53 (ماده ۵۳ ق.م.م): Rent payments require rental withholding tax accrual on 2104
 * - Repealed Art. 104 & 5% Rahdari performance bond (ماده ۱۰۴ منسوخ / سپرده ۵٪ راهداری)
 * - Art. 149 Row 406 (ماده ۱۴۹): Excess depreciation warning
 */
export function runVoucherCompliancePreCheck(
  voucherDesc: string,
  lines: Array<Pick<VoucherLine, 'account_code' | 'description_fa' | 'debit_rial' | 'credit_rial' | 'moadian_tax_id'>>,
  accounts: Account[]
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const balance = computeVoucherBalance(lines);

  if (balance.varianceRial !== 0) {
    issues.push({
      code: 'UNBALANCED_VOUCHER',
      article_ref: 'استاندارد حسابداری ۱',
      severity: 'CRITICAL',
      title_fa: 'سند حسابداری تراز نیست',
      detail_fa: `اختلاف بدهکار و بستانکار برابر با ${Math.abs(balance.varianceRial).toLocaleString('en-US')} ریال است. ثبت سند تا زمان تراز کامل غیرفعال است.`,
      amount_rial: Math.abs(balance.varianceRial),
    });
  }

  const normalizedHeader = normalizePersianText(voucherDesc);
  const allText = [normalizedHeader, ...lines.map((l) => normalizePersianText(l.description_fa))].join(' ');
  const hasWithholdingLine = lines.some((l) => l.account_code === '2104' && l.credit_rial > 0);
  const hasDepositLine = lines.some((l) => l.account_code === '1104' && l.debit_rial > 0);

  // Art. 86 Payroll Withholding Check
  const isPayroll = /(حقوق|دستمزد|عیدی|پاداش|سنوات|مزایا)/.test(allText);
  if (isPayroll && !hasWithholdingLine) {
    issues.push({
      code: 'ART_86_PAYROLL',
      article_ref: 'ماده ۸۶ ق.م.م',
      severity: 'WARNING',
      title_fa: 'عدم شناسایی مالیات تکلیفی حقوق (ماده ۸۶)',
      detail_fa:
        'سند دارای شرح حقوق و دستمزد است اما ردیف بستانکار در حساب ۲۱۰۴ (مالیات تکلیفی و بیمه پرداختنی) ثبت نشده است.',
    });
  }

  // Art. 53 Rent Withholding Check
  const isRent = /(اجاره|مال‌الاجاره|اجاره‌بها|کرایه دفتر|کرایه انبار)/.test(allText);
  if (isRent && !hasWithholdingLine) {
    issues.push({
      code: 'ART_53_RENT',
      article_ref: 'ماده ۵۳ ق.م.م',
      severity: 'WARNING',
      title_fa: 'الزام کسر مالیات تکلیفی اجاره (ماده ۵۳)',
      detail_fa:
        'در پرداخت اجاره املاک، شرکت مکلف به کسر مالیات تکلیفی ماده ۵۳ و ثبت آن در حساب ۲۱۰۴ و ارسال فهرست تا پایان ماه بعد است.',
    });
  }

  // Repealed Art. 104 / 5% Rahdari Performance Bond Check
  const isRahdariOr104 = /(راهداری|ماده ۱۰۴|ماده 104|حسن انجام کار|سپرده ۵|سپرده 5|پیمانکاری)/.test(allText);
  if (isRahdariOr104) {
    issues.push({
      code: 'ART_104_RAHDARI_BOND',
      article_ref: 'ماده ۱۰۴ منسوخ / سپرده ۵٪ راهداری',
      severity: hasDepositLine ? 'INFO' : 'WARNING',
      title_fa: 'کنترل ماده ۱۰۴ منسوخ و سپرده ۵٪ حسن انجام کار راهداری',
      detail_fa: hasDepositLine
        ? 'تکلیف کسر ۳٪ ماده ۱۰۴ از سال ۱۳۹۴ لغو شده است؛ سپرده ۵٪ حسن انجام کار راهداری به‌درستی در حساب ۱۱0۴ ثبت شده است.'
        : 'ماده ۱۰۴ (کسر ۳٪) منسوخ شده است؛ در قراردادهای راهداری صرفاً سپرده ۵٪ حسن انجام کار باید در حساب ۱۱0۴ (پیش‌پرداخت‌ها و سپرده‌ها) ثبت شود و نه به‌عنوان هزینه.',
    });
  }

  // Art. 147 Documented Expense Check
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  const undocumentedExpenseTotal = lines
    .filter((l) => {
      const acc = accountMap.get(l.account_code);
      return (
        acc &&
        acc.category === 'EXPENSE' &&
        l.account_code !== '6105' &&
        l.debit_rial >= 50_000_000 &&
        !l.moadian_tax_id &&
        !isPayroll
      );
    })
    .reduce((sum, l) => sum + Math.trunc(l.debit_rial), 0);

  if (undocumentedExpenseTotal > 0) {
    issues.push({
      code: 'ART_147_UNDOCUMENTED',
      article_ref: 'مواد ۱۴۷ و ۱۴۸ ق.م.م',
      severity: 'WARNING',
      title_fa: 'ریسک برگشت هزینه فاقد شماره مالیاتی سامانه مودیان',
      detail_fa: `مبلغ ${undocumentedExpenseTotal.toLocaleString('en-US')} ریال هزینه بالای ۵۰ میلیون ریال بدون شماره منحصر‌به‌فرد مالیاتی مودیان ثبت شده است و در رسیدگی مالیاتی ریسک غیرقابل‌قبول شدن دارد.`,
      amount_rial: undocumentedExpenseTotal,
    });
  }

  // Art. 149 Depreciation Excess Notice
  const deprLineTotal = lines
    .filter((l) => l.account_code === '6105' && l.debit_rial > 0)
    .reduce((s, l) => s + Math.trunc(l.debit_rial), 0);
  if (deprLineTotal > 256_000_000) {
    issues.push({
      code: 'ART_149_EXCESS_DEPR',
      article_ref: 'ماده ۱۴۹ ق.م.م (ردیف ۴۰۶)',
      severity: 'INFO',
      title_fa: 'تطبیق نرخ استهلاک دفتری با جدول ماده ۱۴۹',
      detail_fa:
        'مازاد استهلاک دفتری نسبت به نرخ مصوب ردیف ۴۰۶ جدول استهلاکات ماده ۱۴۹ باید در اظهارنامه عملکرد به درآمد مشمول مالیات اضافه شود.',
      amount_rial: deprLineTotal,
    });
  }

  return issues;
}

/**
 * Deterministic 6-Column Trial Balance builder strictly in integer Rials.
 * Mirrors Supabase RPC: fn_get_trial_balance(p_fiscal_year_id, p_include_drafts).
 */
export function computeTrialBalance(
  accounts: Account[],
  vouchers: Voucher[],
  includeDrafts: boolean
): TrialBalanceRow[] {
  const scopedVouchers = vouchers.filter((v) =>
    includeDrafts ? v.status !== 'REJECTED' : v.status === 'FINALIZED'
  );

  const openingMap = new Map<string, { debit: number; credit: number }>();
  const turnoverMap = new Map<string, { debit: number; credit: number }>();

  for (const v of scopedVouchers) {
    const targetMap = v.source === 'OPENING' ? openingMap : turnoverMap;
    for (const line of v.lines) {
      const prev = targetMap.get(line.account_code) ?? { debit: 0, credit: 0 };
      prev.debit += Math.trunc(line.debit_rial);
      prev.credit += Math.trunc(line.credit_rial);
      targetMap.set(line.account_code, prev);
    }
  }

  return accounts
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((acc) => {
      const op = openingMap.get(acc.code) ?? { debit: 0, credit: 0 };
      const tr = turnoverMap.get(acc.code) ?? { debit: 0, credit: 0 };
      const net = op.debit + tr.debit - (op.credit + tr.credit);
      return {
        account_id: acc.id,
        account_code: acc.code,
        kol_code: acc.kol_code,
        name_fa: acc.name_fa,
        name_en: acc.name_en,
        category: acc.category,
        normal_balance: acc.normal_balance,
        is_temporary: acc.is_temporary,
        is_contra: acc.is_contra,
        opening_debit_rial: op.debit,
        opening_credit_rial: op.credit,
        turnover_debit_rial: tr.debit,
        turnover_credit_rial: tr.credit,
        ending_debit_rial: net > 0 ? net : 0,
        ending_credit_rial: net < 0 ? Math.abs(net) : 0,
      };
    });
}

/**
 * Deterministic Year-End Closing Simulator strictly in integer Rials.
 * Mirrors Supabase RPC: fn_simulate_year_end_closing(p_fiscal_year_id, p_include_drafts).
 * Computes Revenue, COGS, OpEx, Pre-Tax Profit, 25% Art. 105 Income Tax (2106),
 * Net Profit, 5% Art. 238 Statutory Reserve (3105), and Retained Earnings transfer (3104).
 */
export function simulateYearEndClosing(
  fiscalYearId: string,
  accounts: Account[],
  vouchers: Voucher[],
  fixedAssets: FixedAsset[],
  includeDrafts: boolean
): YearEndSimulationResult {
  const tb = computeTrialBalance(accounts, vouchers, includeDrafts);

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalOpex = 0;

  const closingLines: YearEndSimulationResult['closing_lines_preview'] = [];

  for (const row of tb) {
    if (!row.is_temporary || row.account_code === '8101') continue;

    if (row.category === 'REVENUE') {
      const creditBal = row.ending_credit_rial - row.ending_debit_rial;
      totalRevenue += creditBal;
      if (creditBal > 0) {
        closingLines.push({
          account_code: row.account_code,
          account_name_fa: row.name_fa,
          debit_rial: creditBal,
          credit_rial: 0,
          note_fa: 'بستن حساب موقت درآمد به خلاصه سود و زیان (۸۱۰۱)',
        });
      }
    } else if (row.category === 'EXPENSE') {
      const debitBal = row.ending_debit_rial - row.ending_credit_rial;
      if (row.account_code === '5101') {
        totalCogs += debitBal;
      } else {
        totalOpex += debitBal;
      }
      if (debitBal > 0) {
        closingLines.push({
          account_code: row.account_code,
          account_name_fa: row.name_fa,
          debit_rial: 0,
          credit_rial: debitBal,
          note_fa: 'بستن حساب موقت هزینه به خلاصه سود و زیان (۸۱۰۱)',
        });
      }
    }
  }

  const grossProfit = totalRevenue - totalCogs;
  const preTaxProfit = grossProfit - totalOpex;

  // Disallowed Art. 149 excess depreciation from fixed assets schedule
  const disallowedExpenses = fixedAssets.reduce(
    (sum, a) => sum + Math.max(0, Math.trunc(a.excess_disallowed_rial)),
    0
  );

  // Taxable Income = Pre-Tax Profit + Disallowed Art. 149 Expenses (if profitable)
  const taxableIncome = Math.max(0, preTaxProfit + disallowedExpenses);
  // 25% Corporate Income Tax (Article 105 Direct Tax Act) — integer Rials
  const incomeTax25 = taxableIncome > 0 ? Math.trunc((taxableIncome * 25) / 100) : 0;
  const netProfit = preTaxProfit - incomeTax25;
  // 5% Legal Reserve (Article 140 & 238 Iranian Commercial Code) — integer Rials
  const statutoryReserve5 = netProfit > 0 ? Math.trunc((netProfit * 5) / 100) : 0;
  const retainedTransfer = netProfit - statutoryReserve5;

  if (incomeTax25 > 0) {
    closingLines.push({
      account_code: '2106',
      account_name_fa: 'ذخیره مالیات بر درآمد عملکرد (ماده ۱۰۵)',
      debit_rial: 0,
      credit_rial: incomeTax25,
      note_fa: 'شناسایی ۲۵٪ مالیات عملکرد بر درآمد مشمول مالیات',
    });
  }

  if (statutoryReserve5 > 0) {
    closingLines.push({
      account_code: '3105',
      account_name_fa: 'اندوخته قانونی (ماده ۲۳۸ قانون تجارت)',
      debit_rial: 0,
      credit_rial: statutoryReserve5,
      note_fa: 'تخصیص ۵٪ سود خالص به اندوخته قانونی',
    });
  }

  if (retainedTransfer !== 0) {
    closingLines.push({
      account_code: '3104',
      account_name_fa: 'سود و زیان انباشته',
      debit_rial: retainedTransfer < 0 ? Math.abs(retainedTransfer) : 0,
      credit_rial: retainedTransfer > 0 ? retainedTransfer : 0,
      note_fa: 'انتقال باقیمانده سود خالص به سود و زیان انباشته',
    });
  }

  return {
    fiscal_year_id: fiscalYearId,
    total_revenue_rial: totalRevenue,
    total_cogs_rial: totalCogs,
    gross_profit_rial: grossProfit,
    total_opex_rial: totalOpex,
    pre_tax_profit_rial: preTaxProfit,
    disallowed_expenses_rial: disallowedExpenses,
    taxable_income_rial: taxableIncome,
    income_tax_25pct_rial: incomeTax25,
    net_profit_rial: netProfit,
    statutory_reserve_5pct_rial: statutoryReserve5,
    retained_earnings_transfer_rial: retainedTransfer,
    closing_lines_preview: closingLines,
  };
}

export interface QuarterlyVatSummary {
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  quarterTitleFa: string;
  salesNetRial: number;
  outputVat10Rial: number;
  purchaseNetRial: number;
  inputVat10Rial: number;
  netVatPayableRial: number;
  canceledCount: number;
  rejectedCount: number;
  rejectedAmountRial: number;
}

const QUARTER_LABELS: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', string> = {
  Q1: 'فصل اول (بهار)',
  Q2: 'فصل دوم (تابستان)',
  Q3: 'فصل سوم (پاییز)',
  Q4: 'فصل چهارم (زمستان)',
};

/**
 * Computes the 4-Quarter 10% VAT Matrix excluding canceled ('باطل شده') invoices
 * and isolating rejected ('رد شده') compliance flags.
 */
export function computeQuarterlyVatMatrix(invoices: MoadianInvoice[]): QuarterlyVatSummary[] {
  const quarters: Array<'Q1' | 'Q2' | 'Q3' | 'Q4'> = ['Q1', 'Q2', 'Q3', 'Q4'];
  return quarters.map((q) => {
    const qInvoices = invoices.filter((inv) => inv.quarter === q);
    let salesNetRial = 0;
    let outputVat10Rial = 0;
    let purchaseNetRial = 0;
    let inputVat10Rial = 0;
    let canceledCount = 0;
    let rejectedCount = 0;
    let rejectedAmountRial = 0;

    for (const inv of qInvoices) {
      if (inv.status_fa === 'باطل شده') {
        canceledCount += 1;
        continue;
      }
      if (inv.status_fa === 'رد شده') {
        rejectedCount += 1;
        rejectedAmountRial += Math.trunc(inv.total_amount_rial);
        continue;
      }
      if (inv.direction === 'SALES') {
        salesNetRial += Math.trunc(inv.net_amount_rial);
        outputVat10Rial += Math.trunc(inv.vat_amount_rial);
      } else {
        purchaseNetRial += Math.trunc(inv.net_amount_rial);
        inputVat10Rial += Math.trunc(inv.vat_amount_rial);
      }
    }

    return {
      quarter: q,
      quarterTitleFa: QUARTER_LABELS[q],
      salesNetRial,
      outputVat10Rial,
      purchaseNetRial,
      inputVat10Rial,
      netVatPayableRial: outputVat10Rial - inputVat10Rial,
      canceledCount,
      rejectedCount,
      rejectedAmountRial,
    };
  });
}

export interface TaxExposureSummary {
  undocumentedOutflowsRial: number;
  undocumentedCount: number;
  art149ExcessDepreciationRial: number;
  rejectedMoadianCount: number;
  rejectedMoadianRial: number;
  canceledMoadianCount: number;
  totalExposureRial: number;
}

export function computeTaxComplianceExposure(
  bankTransactions: BankTransaction[],
  fixedAssets: FixedAsset[],
  moadianInvoices: MoadianInvoice[]
): TaxExposureSummary {
  const undocumentedTx = bankTransactions.filter((t) => !t.is_documented && t.withdrawal_rial > 0);
  const undocumentedOutflowsRial = undocumentedTx.reduce((s, t) => s + Math.trunc(t.withdrawal_rial), 0);

  const art149ExcessDepreciationRial = fixedAssets.reduce(
    (s, a) => s + Math.max(0, Math.trunc(a.excess_disallowed_rial)),
    0
  );

  const rejectedInv = moadianInvoices.filter((m) => m.status_fa === 'رد شده');
  const rejectedMoadianRial = rejectedInv.reduce((s, m) => s + Math.trunc(m.total_amount_rial), 0);
  const canceledMoadianCount = moadianInvoices.filter((m) => m.status_fa === 'باطل شده').length;

  return {
    undocumentedOutflowsRial,
    undocumentedCount: undocumentedTx.length,
    art149ExcessDepreciationRial,
    rejectedMoadianCount: rejectedInv.length,
    rejectedMoadianRial,
    canceledMoadianCount,
    totalExposureRial: undocumentedOutflowsRial + art149ExcessDepreciationRial + rejectedMoadianRial,
  };
}
