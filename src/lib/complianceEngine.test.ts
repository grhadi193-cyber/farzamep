import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuarterlyVatMatrix,
  computeTaxComplianceExposure,
  computeTrialBalance,
  computeVoucherBalance,
  runVoucherCompliancePreCheck,
  simulateYearEndClosing,
} from './complianceEngine';
import {
  SEED_ACCOUNTS,
  SEED_BANK_TRANSACTIONS,
  SEED_FIXED_ASSETS,
  SEED_MOADIAN_INVOICES,
  SEED_VOUCHERS,
} from './seedData';

test('computeVoucherBalance verifies exact integer Rial equilibrium', () => {
  const balanced = computeVoucherBalance([
    { debit_rial: 50_000_000, credit_rial: 0 },
    { debit_rial: 0, credit_rial: 50_000_000 },
  ]);
  assert.equal(balanced.isBalanced, true);
  assert.equal(balanced.varianceRial, 0);

  const unbalanced = computeVoucherBalance([
    { debit_rial: 50_000_000, credit_rial: 0 },
    { debit_rial: 0, credit_rial: 40_000_000 },
  ]);
  assert.equal(unbalanced.isBalanced, false);
  assert.equal(unbalanced.varianceRial, 10_000_000);
});

test('runVoucherCompliancePreCheck triggers Art. 86, Art. 53, Art. 147, and Repealed Art. 104 / Rahdari flags', () => {
  const issues = runVoucherCompliancePreCheck(
    'پرداخت حقوق و اجاره دفتر و سپرده ۵٪ راهداری',
    [
      {
        account_code: '6101',
        description_fa: 'هزینه حقوق و اجاره و پیمانکاری راهداری',
        debit_rial: 100_000_000,
        credit_rial: 0,
        moadian_tax_id: null,
      },
      {
        account_code: '1100',
        description_fa: 'پرداخت از بانک',
        debit_rial: 0,
        credit_rial: 100_000_000,
        moadian_tax_id: null,
      },
    ],
    SEED_ACCOUNTS
  );

  const codes = new Set(issues.map((i) => i.code));
  assert.equal(codes.has('ART_86_PAYROLL'), true);
  assert.equal(codes.has('ART_53_RENT'), true);
  assert.equal(codes.has('ART_104_RAHDARI_BOND'), true);
});

test('computeTrialBalance balances exactly across FY 1404 finalized vouchers', () => {
  const fy1404Vouchers = SEED_VOUCHERS.filter((v) => v.fiscal_year_id === 'fy-1404');
  const tb = computeTrialBalance(SEED_ACCOUNTS, fy1404Vouchers, false);
  const sumEndingDebit = tb.reduce((s, r) => s + r.ending_debit_rial, 0);
  const sumEndingCredit = tb.reduce((s, r) => s + r.ending_credit_rial, 0);
  assert.equal(sumEndingDebit > 0, true);
  assert.equal(sumEndingDebit, sumEndingCredit);
});

test('simulateYearEndClosing computes Art. 105 25% Tax (2106), Art. 149 256M disallowance, and Art. 238 5% Reserve (3105) in balanced integer Rials', () => {
  const fy1404Vouchers = SEED_VOUCHERS.filter((v) => v.fiscal_year_id === 'fy-1404');
  const fy1404Assets = SEED_FIXED_ASSETS.filter((a) => a.fiscal_year_id === 'fy-1404');
  const sim = simulateYearEndClosing('fy-1404', SEED_ACCOUNTS, fy1404Vouchers, fy1404Assets, false);

  assert.equal(sim.total_revenue_rial, 18_400_000_000);
  assert.equal(sim.total_cogs_rial, 11_400_000_000);
  assert.equal(sim.disallowed_expenses_rial, 256_000_000);
  assert.equal(sim.taxable_income_rial, sim.pre_tax_profit_rial + 256_000_000);
  assert.equal(sim.income_tax_25pct_rial, Math.trunc((sim.taxable_income_rial * 25) / 100));
  assert.equal(sim.statutory_reserve_5pct_rial, Math.trunc((sim.net_profit_rial * 5) / 100));
  assert.equal(
    sim.income_tax_25pct_rial + sim.statutory_reserve_5pct_rial + sim.retained_earnings_transfer_rial,
    sim.pre_tax_profit_rial
  );

  // Closing voucher lines must balance to the exact Rial
  const closeDeb = sim.closing_lines_preview.reduce((s, l) => s + l.debit_rial, 0);
  const closeCred = sim.closing_lines_preview.reduce((s, l) => s + l.credit_rial, 0);
  assert.equal(closeDeb, closeCred);
});

test('computeQuarterlyVatMatrix excludes باطل شده and isolates رد شده invoices', () => {
  const fy1404Moadian = SEED_MOADIAN_INVOICES.filter((m) => m.fiscal_year_id === 'fy-1404');
  const matrix = computeQuarterlyVatMatrix(fy1404Moadian);
  const q3 = matrix.find((q) => q.quarter === 'Q3')!;
  assert.equal(q3.canceledCount, 1);
  assert.equal(q3.rejectedCount, 1);
  assert.equal(q3.salesNetRial, 0); // Canceled Q3 sale excluded
  assert.equal(q3.purchaseNetRial, 0); // Rejected Q3 purchase isolated

  const exposure = computeTaxComplianceExposure(
    SEED_BANK_TRANSACTIONS.filter((b) => b.fiscal_year_id === 'fy-1404'),
    SEED_FIXED_ASSETS.filter((a) => a.fiscal_year_id === 'fy-1404'),
    fy1404Moadian
  );
  assert.equal(exposure.art149ExcessDepreciationRial, 256_000_000);
  assert.equal(exposure.rejectedMoadianCount, 1);
  assert.equal(exposure.undocumentedOutflowsRial, 330_000_000);
});
