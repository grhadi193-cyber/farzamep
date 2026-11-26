import type { CurrencyUnit } from '../types/erp';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Normalizes Arabic characters (ي / ك / ة / أ / إ) into standard Persian Unicode (ی / ک)
 * and strips zero-width anomalies/extra spaces.
 */
export function normalizePersianText(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .replace(/\u064A/g, '\u06CC') // ي -> ی
    .replace(/\u0649/g, '\u06CC') // ى -> ی
    .replace(/\u0643/g, '\u06A9') // ك -> ک
    .replace(/\u0629/g, '\u0647') // ة -> ه
    .replace(/[\u0623\u0625\u0622]/g, (m) => (m === '\u0622' ? '\u0622' : '\u0627'))
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toEnglishDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  let str = String(input);
  for (let i = 0; i < 10; i++) {
    str = str.replace(new RegExp(PERSIAN_DIGITS[i], 'g'), String(i));
    str = str.replace(new RegExp(ARABIC_DIGITS[i], 'g'), String(i));
  }
  return str;
}

export function toPersianDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/**
 * Strictly parses an amount into an integer Rial (BIGINT compatible).
 * Never produces floating point decimals.
 */
export function parseRialInteger(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    return Math.trunc(input);
  }
  const normalized = toEnglishDigits(input)
    .replace(/[٬,،\s_]/g, '')
    .replace(/ریال|تومان|IRR|IRT/gi, '')
    .trim();

  if (!normalized || normalized === '-') return 0;
  // Handle parenthetical negatives e.g. (1250000)
  const isParenNegative = /^\(.+\)$/.test(normalized);
  const cleaned = normalized.replace(/[()]/g, '');
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return 0;
  const intVal = Math.trunc(numeric);
  return isParenNegative ? -Math.abs(intVal) : intVal;
}

/**
 * Formats integer Rials for display.
 * When unit === 'TOMAN' (UI-only viewing), divides integer Rials by 10 using pure integer arithmetic
 * so zero floating-point drift occurs. Official printouts always pass unit = 'RIAL'.
 */
export function formatCurrency(
  amountRial: number,
  unit: CurrencyUnit = 'RIAL',
  options?: { showUnit?: boolean; compact?: boolean; useLatinDigits?: boolean }
): string {
  const safeRial = Number.isFinite(amountRial) ? Math.trunc(amountRial) : 0;
  const isNegative = safeRial < 0;
  const absRial = Math.abs(safeRial);

  let displayNumber: number;
  if (unit === 'TOMAN') {
    // Pure integer division for Toman display (1 Toman = 10 Rials)
    displayNumber = Math.trunc(absRial / 10);
  } else {
    displayNumber = absRial;
  }

  let formattedCore: string;
  if (options?.compact && displayNumber >= 1_000_000_000) {
    const billions = Math.trunc(displayNumber / 100_000_000) / 10;
    formattedCore = `${billions.toLocaleString('en-US', { maximumFractionDigits: 1 })} میلیارد`;
  } else {
    formattedCore = displayNumber.toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  }

  const signed = isNegative ? `(${formattedCore})` : formattedCore;
  const digitFormatted = options?.useLatinDigits ? signed : toPersianDigits(signed);

  if (options?.showUnit) {
    const unitLabel = unit === 'TOMAN' ? 'تومان' : 'ریال';
    return `${digitFormatted} ${unitLabel}`;
  }
  return digitFormatted;
}

export function unitLabelFa(unit: CurrencyUnit): string {
  return unit === 'TOMAN' ? 'تومان' : 'ریال';
}

/**
 * Detects malformed OCR comma grouping in Trial Balance files.
 * Example from Iranian scanned/OCR ledgers: "50412,530,000" where the leading group has >3 digits
 * (typically a stray '0' inserted by OCR into "5,412,530,000").
 */
export interface OcrSanityResult {
  isSuspect: boolean;
  rawText: string;
  parsedRawRial: number;
  suggestedRial: number | null;
  suggestedFormatted: string | null;
  reasonFa: string | null;
}

export function checkOcrCommaGrouping(rawValue: string | number | null | undefined): OcrSanityResult {
  const rawText = toEnglishDigits(String(rawValue ?? '')).trim();
  const parsedRawRial = parseRialInteger(rawText);

  if (!rawText || !rawText.includes(',')) {
    return {
      isSuspect: false,
      rawText,
      parsedRawRial,
      suggestedRial: null,
      suggestedFormatted: null,
      reasonFa: null,
    };
  }

  const unsigned = rawText.replace(/^[-+]/, '');
  const parts = unsigned.split(',');

  // Valid thousands grouping: first part 1..3 digits, all subsequent parts strictly 3 digits
  const firstInvalid = parts[0].length > 3 || parts[0].length === 0;
  const middleOrLastInvalid = parts.slice(1).some((p) => p.length !== 3);

  if (!firstInvalid && !middleOrLastInvalid) {
    return {
      isSuspect: false,
      rawText,
      parsedRawRial,
      suggestedRial: null,
      suggestedFormatted: null,
      reasonFa: null,
    };
  }

  let suggestedRial: number | null = null;
  // Classic OCR bug: "50412,530,000" -> leading group is 5 digits with a spurious 0 at index 1 ("50412" -> "5,412")
  if (parts[0].length === 5 && parts[0][1] === '0' && parts.slice(1).every((p) => p.length === 3)) {
    const fixedLead = parts[0][0] + parts[0].slice(2); // "5412"
    suggestedRial = parseRialInteger(fixedLead + parts.slice(1).join(''));
  } else if (parts[0].length === 4 && parts.slice(1).every((p) => p.length === 3)) {
    // Missing comma in leading 4-digit group e.g. "5412,530,000" -> "5,412,530,000"
    suggestedRial = parsedRawRial;
  } else {
    // Generic re-grouped value warning
    suggestedRial = parsedRawRial;
  }

  const suggestedFormatted =
    suggestedRial !== null ? suggestedRial.toLocaleString('en-US', { maximumFractionDigits: 0 }) : null;

  return {
    isSuspect: true,
    rawText,
    parsedRawRial,
    suggestedRial,
    suggestedFormatted,
    reasonFa:
      parts[0].length === 5 && parts[0][1] === '0'
        ? `خطای گروه‌بندی OCR تشخیص داده شد (${rawText} ← احتمالاً ${suggestedFormatted})`
        : `گروه‌بندی سه‌رقمی ویرگول نامعتبر است (${rawText})`,
  };
}

/**
 * Pure algorithmic Gregorian -> Jalali (Solar Hijri) converter (Kazimierz Borkowski / Jalaali algorithm).
 */
export function gregorianToJalali(gy: number, gm: number, gd: number): string {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/**
 * Converts Excel OLE Automation serial date (days since 1899-12-30) to both ISO Gregorian and Jalali strings.
 */
export function oleSerialToJalali(serial: number): { iso: string; jalali: string } {
  if (!Number.isFinite(serial) || serial < 1) {
    return { iso: '2025-03-21', jalali: '1404/01/01' };
  }
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const date = new Date(utcMs);
  const gy = date.getUTCFullYear();
  const gm = date.getUTCMonth() + 1;
  const gd = date.getUTCDate();
  const iso = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  const jalali = gregorianToJalali(gy, gm, gd);
  return { iso, jalali };
}

export function formatIban(iban: string | null | undefined): string {
  if (!iban) return '—';
  const clean = iban.replace(/\s+/g, '').toUpperCase();
  return clean.replace(/(.{4})/g, '$1 ').trim();
}
