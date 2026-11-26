import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleWorkbookBuffer, parseAccountingExcelBuffer } from './excelParsers';

test('Bank Eghtesad Novin parser skips 7 metadata rows, ignores E4, reverses نزولی rows, and proves balance continuity', () => {
  const { buffer, fileName } = buildSampleWorkbookBuffer('BANK_EGHTESAD_NOVIN');
  const parsed = parseAccountingExcelBuffer(buffer, fileName);

  assert.equal(parsed.format, 'BANK_EGHTESAD_NOVIN');
  assert.equal(parsed.continuitySummary?.wasReversedFromDescending, true);
  assert.equal(parsed.continuitySummary?.failed, 0);
  assert.equal(parsed.continuitySummary?.passed, 4);
  assert.equal(parsed.continuitySummary?.ignoredE4Value, 'STATIC_E4_DO_NOT_READ_999999999');
  // Chronologically reversed so earliest date (1404/04/12) comes first
  assert.equal(parsed.rows[0].data.jalali_date, '1404/04/12');
  assert.equal(parsed.rows[3].data.jalali_date, '1404/06/28');
});

test('Moadian Sales 32-col parser normalizes ي/ك -> ی/ک, excludes باطل شده, and flags رد شده', () => {
  const { buffer, fileName } = buildSampleWorkbookBuffer('MOADIAN_SALES');
  const parsed = parseAccountingExcelBuffer(buffer, fileName);

  assert.equal(parsed.format, 'MOADIAN_SALES');
  assert.equal(parsed.detectedColumns, 32);
  assert.equal(parsed.excludedRowsCount, 1);
  assert.equal(parsed.flaggedRowsCount, 1);
  assert.equal(parsed.rows[0].data.counterparty_name, 'شرکت بازرگانی فولاد پارس (عربی)');
  assert.equal(parsed.rows[2].excluded, true);
});

test('Catalog parser converts OLE serial dates and maps GroupGuid', () => {
  const { buffer, fileName } = buildSampleWorkbookBuffer('CATALOG_PARTIES_PRODUCTS');
  const parsed = parseAccountingExcelBuffer(buffer, fileName);

  assert.equal(parsed.format, 'CATALOG_PARTIES_PRODUCTS');
  assert.equal(parsed.rows[0].data.created_jalali, '1404/01/06');
  assert.equal(parsed.rows[0].data.group_label, 'مشتریان عمده بازرگانی داخلی');
});

test('Fixed Assets (تجهیزات.xlsx) parser computes exact 256,000,000 Rial Art. 149 Row 406 excess depreciation', () => {
  const { buffer, fileName } = buildSampleWorkbookBuffer('FIXED_ASSETS');
  const parsed = parseAccountingExcelBuffer(buffer, fileName);

  assert.equal(parsed.format, 'FIXED_ASSETS');
  assert.equal(parsed.rows[0].data.book_depr_rial, 640_000_000);
  assert.equal(parsed.rows[0].data.statutory_depr_rial, 384_000_000);
  assert.equal(parsed.rows[0].data.excess_rial, 256_000_000);
});

test('Trial Balance parser flags OCR comma-grouping error 50412,530,000 -> 5,412,530,000', () => {
  const { buffer, fileName } = buildSampleWorkbookBuffer('TRIAL_BALANCE');
  const parsed = parseAccountingExcelBuffer(buffer, fileName);

  assert.equal(parsed.format, 'TRIAL_BALANCE');
  assert.equal(parsed.ocrCorrections?.length, 1);
  assert.equal(parsed.ocrCorrections?.[0].rawText, '50412,530,000');
  assert.equal(parsed.ocrCorrections?.[0].suggestedValueRial, 5_412_530_000);
});
