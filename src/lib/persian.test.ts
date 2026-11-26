import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOcrCommaGrouping,
  formatCurrency,
  normalizePersianText,
  oleSerialToJalali,
  parseRialInteger,
} from './persian';

test('parseRialInteger strictly produces integer Rials without floating-point drift', () => {
  assert.equal(parseRialInteger('5,412,530,000'), 5_412_530_000);
  assert.equal(parseRialInteger('۵,۴۱۲,۵۳۰,۰۰۰ ریال'), 5_412_530_000);
  assert.equal(parseRialInteger('(256,000,000)'), -256_000_000);
  assert.equal(parseRialInteger(123456.99), 123456);
});

test('formatCurrency divides by 10 only for TOMAN UI viewing while preserving integer math', () => {
  assert.equal(formatCurrency(5_412_530_000, 'RIAL', { useLatinDigits: true }), '5,412,530,000');
  assert.equal(formatCurrency(5_412_530_000, 'TOMAN', { useLatinDigits: true }), '541,253,000');
  assert.equal(formatCurrency(256_000_000, 'TOMAN', { useLatinDigits: true, showUnit: true }), '25,600,000 تومان');
});

test('normalizePersianText converts Arabic ي and ك to Persian ی and ک', () => {
  assert.equal(normalizePersianText('شركت بازرگاني فولاد'), 'شرکت بازرگانی فولاد');
  assert.equal(normalizePersianText('باطل شده'), 'باطل شده');
});

test('checkOcrCommaGrouping flags malformed OCR string 50412,530,000 and suggests 5,412,530,000', () => {
  const suspect = checkOcrCommaGrouping('50412,530,000');
  assert.equal(suspect.isSuspect, true);
  assert.equal(suspect.suggestedRial, 5_412_530_000);
  assert.equal(suspect.suggestedFormatted, '5,412,530,000');

  const clean = checkOcrCommaGrouping('5,412,530,000');
  assert.equal(clean.isSuspect, false);
});

test('oleSerialToJalali converts Excel OLE serial dates to valid ISO and Jalali dates', () => {
  const result = oleSerialToJalali(45742); // 2025-03-26 -> 1404/01/06
  assert.equal(result.iso, '2025-03-26');
  assert.equal(result.jalali, '1404/01/06');
});
