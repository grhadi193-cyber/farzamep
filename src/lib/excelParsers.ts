import * as XLSX from 'xlsx';
import type { ExcelFormatType, ParsedExcelResult, ParsedExcelRow } from '../types/erp';
import {
  checkOcrCommaGrouping,
  normalizePersianText,
  oleSerialToJalali,
  parseRialInteger,
  toEnglishDigits,
} from './persian';

const GROUP_GUID_MAP: Record<string, string> = {
  '9a1b2c3d-1001-4a00-8b01-000000000001': 'مشتریان عمده بازرگانی داخلی',
  '9a1b2c3d-1002-4a00-8b01-000000000002': 'تأمین‌کنندگان کالای صنعتی و پتروشیمی',
  '9a1b2c3d-1003-4a00-8b01-000000000003': 'پیمانکاران حمل‌ونقل و راهداری',
  '7f4e5d6c-2001-4b00-9c02-000000000010': 'گروه کالایی: تجهیزات صنعتی و قطعات',
  '7f4e5d6c-2002-4b00-9c02-000000000020': 'گروه کالایی: مواد اولیه و شیمیایی',
};

export function categorizeBankDescription(descriptionFa: string, deposit: number, withdrawal: number): string {
  const text = normalizePersianText(descriptionFa);
  if (/(حقوق|دستمزد|عیدی|پاداش)/.test(text)) return '6101 (هزینه حقوق و اداری)';
  if (/(اجاره|کرایه دفتر|انبار)/.test(text)) return '6101 (هزینه اجاره - ماده ۵۳)';
  if (/(مالیات|ارزش افزوده|تامین اجتماعی|بیمه)/.test(text)) return '2104 (مالیات و بیمه پرداختنی)';
  if (/(راهداری|سپرده|حسن انجام کار|ضمانتنامه)/.test(text)) return '1104 (پیش‌پرداخت و سپرده ۵٪)';
  if (/(خرید کالا|تامین|فولاد|پتروشیمی|تجهیزات)/.test(text)) return '2101 (پرداختنی تجاری / خرید)';
  if (/(تنخواه|کارپرداز)/.test(text)) return '1100 (انتقال بین‌بانکی / تنخواه)';
  if (deposit > 0) return '1102 (وصول مطالبات / فروش)';
  if (withdrawal > 0) return '6101 (سایر پرداخت‌ها — نیازمند مستندات ماده ۱۴۷)';
  return '1100';
}

function detectWorkbookFormat(
  rows: unknown[][],
  fileName: string
): ExcelFormatType {
  const lowerName = normalizePersianText(fileName).toLowerCase();
  const topText = rows
    .slice(0, 12)
    .flat()
    .map((c) => normalizePersianText(String(c ?? '')))
    .join(' ');

  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);

  // (a) Bank Eghtesad Novin & Petty Cash
  if (
    /اقتصاد نوین|صورتحساب|گردش حساب|تنخواه|مانده پس از تراکنش|بدهکار.*بستانکار.*مانده/.test(topText) ||
    /enbank|eghtesad|bank|تنخواه/.test(lowerName)
  ) {
    if (rows.length >= 8 && (/اقتصاد نوین|شماره حساب|شبا|تاریخ گزارش|نزولی|صعودی/.test(topText) || maxCols <= 12)) {
      return 'BANK_EGHTESAD_NOVIN';
    }
  }

  // (b) Moadian Sales (32 cols) & Purchases (29 cols)
  if (/شماره منحصر|مودیان|مالیات بر ارزش افزوده|وضعیت صورتحساب|شماره مالیاتی/.test(topText) || maxCols === 32 || maxCols === 29) {
    if (maxCols >= 31 || /فروش|sales/.test(lowerName) || /خریداران|فروش/.test(topText)) {
      return 'MOADIAN_SALES';
    }
    return 'MOADIAN_PURCHASES';
  }

  // (d) Fixed Assets (تجهیزات.xlsx)
  if (
    /تجهیزات|دارایی ثابت|استهلاک|ردیف ۴۰۶|ماده ۱۴۹|بهای تمام شده دارایی/.test(topText) ||
    /تجهیزات|asset|fixed/.test(lowerName)
  ) {
    return 'FIXED_ASSETS';
  }

  // (c) Customer & Product Catalogs (GroupGuid / OLE dates)
  if (/groupguid|شناسه گروه|کد کالا|طرف حساب|کد تفصیلی/.test(topText.toLowerCase()) || /customer|product|catalog|مشتری|کالا/.test(lowerName)) {
    return 'CATALOG_PARTIES_PRODUCTS';
  }

  // (e) Trial Balance
  if (/تراز آزمایشی|مانده بدهکار|مانده بستانکار|گردش بدهکار|کد معین/.test(topText) || /trial|تراز/.test(lowerName)) {
    return 'TRIAL_BALANCE';
  }

  return 'BANK_EGHTESAD_NOVIN';
}

/**
 * Parses an ArrayBuffer of an .xls (BIFF8) or .xlsx workbook using SheetJS 0.20.3
 * and runs Ati Farzam's domain-specific validation, normalization, continuity proof, and OCR checks.
 */
export function parseAccountingExcelBuffer(buffer: ArrayBuffer, fileName: string): ParsedExcelResult {
  const workbook = XLSX.read(buffer, { type: 'array', raw: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  const format = detectWorkbookFormat(rawMatrix, fileName);

  switch (format) {
    case 'BANK_EGHTESAD_NOVIN':
      return parseBankEghtesadNovin(sheet, rawMatrix, fileName);
    case 'MOADIAN_SALES':
      return parseMoadianSheet(rawMatrix, fileName, 'SALES');
    case 'MOADIAN_PURCHASES':
      return parseMoadianSheet(rawMatrix, fileName, 'PURCHASE');
    case 'CATALOG_PARTIES_PRODUCTS':
      return parseCatalogSheet(rawMatrix, fileName);
    case 'FIXED_ASSETS':
      return parseFixedAssetsSheet(rawMatrix, fileName);
    case 'TRIAL_BALANCE':
      return parseTrialBalanceSheet(rawMatrix, fileName);
  }
}

/**
 * Format A: Bank Eghtesad Novin & Petty Cash (.xls/.xlsx)
 * - Skips 7 metadata rows (rows 0..6)
 * - Explicitly ignores static cell E4 (Bank EN header summary artifact)
 * - Detects نزولی (descending) ordering and reverses chronologically
 * - Proves prev + dep - wd === curr balance continuity on every row
 * - Auto-categorizes transactions into Ati Farzam Moein codes
 */
function parseBankEghtesadNovin(
  sheet: XLSX.WorkSheet,
  matrix: unknown[][],
  fileName: string
): ParsedExcelResult {
  const e4Cell = sheet['E4'] ? String(sheet['E4'].v ?? '') : null;
  const metaText = matrix
    .slice(0, 7)
    .flat()
    .map((x) => normalizePersianText(String(x ?? '')))
    .join(' ');

  // Skip 7 metadata rows; row index 7 is header row, data starts at row index 8
  const headerIdx = matrix.length > 8 ? 7 : 0;
  const dataStartIdx = matrix.length > 8 ? 8 : 1;
  const headers = (matrix[headerIdx] ?? []).map((h) => normalizePersianText(String(h ?? '')));

  const findCol = (regex: RegExp, fallback: number) => {
    const idx = headers.findIndex((h) => regex.test(h));
    return idx >= 0 ? idx : fallback;
  };

  const dateCol = findCol(/تاریخ/, 0);
  const trackCol = findCol(/پیگیری|شماره سند|مرجع/, 1);
  const descCol = findCol(/شرح|توضیحات/, 2);
  const depCol = findCol(/بستانکار|واریز/, 3);
  const wdCol = findCol(/بدهکار|برداشت/, 4);
  const balCol = findCol(/مانده/, 5);

  let rawEntries = matrix
    .slice(dataStartIdx)
    .map((row, i) => ({
      origRow: dataStartIdx + i + 1,
      jalali_date: toEnglishDigits(normalizePersianText(String(row[dateCol] ?? ''))),
      tracking_no: toEnglishDigits(normalizePersianText(String(row[trackCol] ?? ''))),
      description_fa: normalizePersianText(String(row[descCol] ?? '')),
      deposit_rial: parseRialInteger(row[depCol] as string | number),
      withdrawal_rial: parseRialInteger(row[wdCol] as string | number),
      balance_rial: parseRialInteger(row[balCol] as string | number),
    }))
    .filter((r) => r.jalali_date || r.deposit_rial !== 0 || r.withdrawal_rial !== 0);

  // Determine descending (نزولی) order from metadata OR dates comparison
  const markedDescending = /نزولی/.test(metaText);
  const dateDescending =
    rawEntries.length >= 2 &&
    rawEntries[0].jalali_date > rawEntries[rawEntries.length - 1].jalali_date;
  const wasReversed = markedDescending || dateDescending;

  if (wasReversed) {
    rawEntries = rawEntries.slice().reverse();
  }

  let passed = 0;
  let failed = 0;
  let flaggedRowsCount = 0;

  const parsedRows: ParsedExcelRow[] = rawEntries.map((entry, idx) => {
    const flags: string[] = [];
    let continuityOk = true;

    if (idx > 0) {
      const prevBal = rawEntries[idx - 1].balance_rial;
      const expected = prevBal + entry.deposit_rial - entry.withdrawal_rial;
      if (expected !== entry.balance_rial) {
        continuityOk = false;
        failed += 1;
        flags.push(
          `عدم پیوستگی مانده: مانده مورد انتظار ${expected.toLocaleString('en-US')} ≠ ${entry.balance_rial.toLocaleString('en-US')}`
        );
      } else {
        passed += 1;
      }
    } else {
      passed += 1;
    }

    const suggestedAccount = categorizeBankDescription(
      entry.description_fa,
      entry.deposit_rial,
      entry.withdrawal_rial
    );

    if (entry.withdrawal_rial >= 50_000_000 && suggestedAccount.includes('ماده ۱۴۷')) {
      flags.push('برداشت فاقد مستندات شفاف (هشدار ماده ۱۴۷)');
    }

    if (flags.length > 0) flaggedRowsCount += 1;

    return {
      rowIndex: entry.origRow,
      data: {
        jalali_date: entry.jalali_date,
        tracking_no: entry.tracking_no || `EN-${idx + 1}`,
        description_fa: entry.description_fa,
        deposit_rial: entry.deposit_rial,
        withdrawal_rial: entry.withdrawal_rial,
        balance_rial: entry.balance_rial,
        continuity: continuityOk ? 'تأیید شده' : 'مغایرت مانده',
        suggested_account: suggestedAccount,
      },
      flags,
      severity: !continuityOk ? 'ERROR' : flags.length > 0 ? 'WARNING' : 'OK',
    };
  });

  const notes = [
    '۷ ردیف فراداده ابتدای فایل صورتحساب بانک اقتصاد نوین نادیده گرفته شد.',
    e4Cell
      ? `سلول استاتیک E4 («${normalizePersianText(e4Cell)}») جهت جلوگیری از خطای مانده نادیده گرفته شد.`
      : 'سلول استاتیک E4 خالی بود و نادیده گرفته شد.',
    wasReversed
      ? 'ترتیب نزولی (جدید به قدیم) شناسایی و ردیف‌ها به‌صورت خودکار به ترتیب زمانی صعودی معکوس شدند.'
      : 'ترتیب زمانی ردیف‌ها صعودی است.',
  ];

  return {
    format: 'BANK_EGHTESAD_NOVIN',
    formatTitleFa: 'صورتحساب بانک اقتصاد نوین و تنخواه (BIFF8 .xls / .xlsx)',
    fileName,
    detectedColumns: headers.length || 6,
    totalRawRows: rawEntries.length,
    validRowsCount: rawEntries.length,
    excludedRowsCount: 0,
    flaggedRowsCount,
    metadataNotes: notes,
    continuitySummary: {
      checked: rawEntries.length,
      passed,
      failed,
      wasReversedFromDescending: wasReversed,
      ignoredE4Value: e4Cell,
    },
    columns: [
      { key: 'jalali_date', labelFa: 'تاریخ', isLtr: true },
      { key: 'tracking_no', labelFa: 'شماره پیگیری', isLtr: true },
      { key: 'description_fa', labelFa: 'شرح تراکنش' },
      { key: 'deposit_rial', labelFa: 'واریز (بستانکار)', isNumeric: true },
      { key: 'withdrawal_rial', labelFa: 'برداشت (بدهکار)', isNumeric: true },
      { key: 'balance_rial', labelFa: 'مانده پس از تراکنش', isNumeric: true },
      { key: 'continuity', labelFa: 'اثبات پیوستگی' },
      { key: 'suggested_account', labelFa: 'معین پیشنهادی' },
    ],
    rows: parsedRows,
  };
}

/**
 * Format B: Moadian Sales (32 cols) & Purchases (29 cols)
 * - Normalizes Arabic ي/ك -> Persian ی/ک
 * - Excludes وضعیت === 'باطل شده'
 * - Flags رد شده rows
 */
function parseMoadianSheet(
  matrix: unknown[][],
  fileName: string,
  direction: 'SALES' | 'PURCHASE'
): ParsedExcelResult {
  const headers = (matrix[0] ?? []).map((h) => normalizePersianText(String(h ?? '')));
  const findCol = (regex: RegExp, fallback: number) => {
    const idx = headers.findIndex((h) => regex.test(h));
    return idx >= 0 ? idx : fallback;
  };

  const taxIdCol = findCol(/شماره منحصر|شماره مالیاتی|tax/i, 0);
  const dateCol = findCol(/تاریخ صدور|تاریخ/, 1);
  const partyCol = findCol(/نام خریدار|نام فروشنده|طرف حساب|نام مودی/, 2);
  const natIdCol = findCol(/شناسه ملی|کد ملی|شماره اقتصادی/, 3);
  const netCol = findCol(/مبلغ قبل از مالیات|مبلغ خالص|مبلغ کل کالا/, 4);
  const vatCol = findCol(/مالیات بر ارزش افزوده|مبلغ مالیات/, 5);
  const statusCol = findCol(/وضعیت/, 6);

  let excludedRowsCount = 0;
  let flaggedRowsCount = 0;
  let validRowsCount = 0;

  const parsedRows: ParsedExcelRow[] = matrix
    .slice(1)
    .filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row, i) => {
      const taxId = toEnglishDigits(normalizePersianText(String(row[taxIdCol] ?? '')));
      const jalaliDate = toEnglishDigits(normalizePersianText(String(row[dateCol] ?? '')));
      const party = normalizePersianText(String(row[partyCol] ?? ''));
      const natId = toEnglishDigits(normalizePersianText(String(row[natIdCol] ?? '')));
      const netRial = parseRialInteger(row[netCol] as string | number);
      const vatRial = parseRialInteger(row[vatCol] as string | number);
      const statusFa = normalizePersianText(String(row[statusCol] ?? 'تایید شده'));

      const flags: string[] = [];
      let excluded = false;
      let severity: 'OK' | 'WARNING' | 'ERROR' = 'OK';

      if (statusFa === 'باطل شده') {
        excluded = true;
        excludedRowsCount += 1;
        flags.push('مستثنی‌شده از ثبت (وضعیت: باطل شده)');
        severity = 'WARNING';
      } else if (statusFa === 'رد شده') {
        flaggedRowsCount += 1;
        flags.push('هشدار انطباق: صورتحساب در کارپوشه مودیان رد شده است');
        severity = 'ERROR';
      } else {
        validRowsCount += 1;
      }

      // 10% VAT consistency check
      const expectedVat = Math.trunc((netRial * 10) / 100);
      if (!excluded && vatRial > 0 && Math.abs(vatRial - expectedVat) > 1000) {
        flags.push('اختلاف نرخ مالیات بر ارزش افزوده با نرخ ۱۰٪');
        if (severity === 'OK') severity = 'WARNING';
      }

      return {
        rowIndex: i + 2,
        excluded,
        severity,
        flags,
        data: {
          tax_id: taxId,
          jalali_date: jalaliDate,
          counterparty_name: party,
          counterparty_national_id: natId,
          net_amount_rial: netRial,
          vat_amount_rial: vatRial,
          total_amount_rial: netRial + vatRial,
          status_fa: statusFa,
        },
      };
    });

  return {
    format: direction === 'SALES' ? 'MOADIAN_SALES' : 'MOADIAN_PURCHASES',
    formatTitleFa:
      direction === 'SALES'
        ? 'گزارش فروش سامانه مودیان (۳۲ ستون)'
        : 'گزارش خرید سامانه مودیان (۲۹ ستون)',
    fileName,
    detectedColumns: headers.length,
    totalRawRows: parsedRows.length,
    validRowsCount,
    excludedRowsCount,
    flaggedRowsCount,
    metadataNotes: [
      'تمامی کاراکترهای عربی (ي و ك) به حروف استاندارد فارسی (ی و ک) نرمال‌سازی شدند.',
      `ردیف‌های با وضعیت «باطل شده» (${excludedRowsCount} مورد) از محاسبه مالیات و درج در دفتر کل مستثنی شدند.`,
      `ردیف‌های با وضعیت «رد شده» (${flaggedRowsCount} مورد) جهت پیگیری اصلاحیه نشانه‌گذاری شدند.`,
    ],
    columns: [
      { key: 'tax_id', labelFa: 'شماره مالیاتی', isLtr: true },
      { key: 'jalali_date', labelFa: 'تاریخ صدور', isLtr: true },
      { key: 'counterparty_name', labelFa: direction === 'SALES' ? 'خریدار' : 'فروشنده' },
      { key: 'counterparty_national_id', labelFa: 'شناسه ملی', isLtr: true },
      { key: 'net_amount_rial', labelFa: 'مبلغ خالص', isNumeric: true },
      { key: 'vat_amount_rial', labelFa: 'ارزش افزوده ۱۰٪', isNumeric: true },
      { key: 'status_fa', labelFa: 'وضعیت مودیان' },
    ],
    rows: parsedRows,
  };
}

/**
 * Format C: Customer & Product Catalogs
 * - Converts OLE serial dates to ISO & Jalali
 * - Maps GroupGuid to Persian domain labels
 */
function parseCatalogSheet(matrix: unknown[][], fileName: string): ParsedExcelResult {
  const headers = (matrix[0] ?? []).map((h) => normalizePersianText(String(h ?? '')));
  const findCol = (regex: RegExp, fallback: number) => {
    const idx = headers.findIndex((h) => regex.test(h));
    return idx >= 0 ? idx : fallback;
  };

  const codeCol = findCol(/کد|sku|code/i, 0);
  const nameCol = findCol(/نام|عنوان|name/i, 1);
  const natCol = findCol(/شناسه ملی|شناسه کالا|national/i, 2);
  const guidCol = findCol(/groupguid|شناسه گروه|guid/i, 3);
  const dateCol = findCol(/تاریخ|created|ole|date/i, 4);

  const parsedRows: ParsedExcelRow[] = matrix
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((row, i) => {
      const code = toEnglishDigits(normalizePersianText(String(row[codeCol] ?? '')));
      const nameFa = normalizePersianText(String(row[nameCol] ?? ''));
      const identifier = toEnglishDigits(normalizePersianText(String(row[natCol] ?? '')));
      const rawGuid = String(row[guidCol] ?? '').trim().toLowerCase();
      const mappedGroup = GROUP_GUID_MAP[rawGuid] ?? (rawGuid ? `گروه عمومی (${rawGuid.slice(0, 8)})` : 'بدون گروه');

      const rawDate = row[dateCol];
      const numericSerial = typeof rawDate === 'number' ? rawDate : Number(toEnglishDigits(String(rawDate ?? '')));
      const converted =
        Number.isFinite(numericSerial) && numericSerial > 30000 && numericSerial < 60000
          ? oleSerialToJalali(numericSerial)
          : { iso: '—', jalali: toEnglishDigits(String(rawDate ?? '1404/01/01')) };

      return {
        rowIndex: i + 2,
        severity: 'OK',
        flags: [],
        data: {
          code,
          name_fa: nameFa,
          identifier,
          group_guid: rawGuid || '—',
          group_label: mappedGroup,
          created_jalali: converted.jalali,
          created_iso: converted.iso,
        },
      };
    });

  return {
    format: 'CATALOG_PARTIES_PRODUCTS',
    formatTitleFa: 'اطلاعات پایه مشتریان و کالاها (تبدیل OLE Date و GroupGuid)',
    fileName,
    detectedColumns: headers.length,
    totalRawRows: parsedRows.length,
    validRowsCount: parsedRows.length,
    excludedRowsCount: 0,
    flaggedRowsCount: 0,
    metadataNotes: [
      'تاریخ‌های عددی OLE Automation اکسل به تاریخ رسمی شمسی و میلادی تبدیل شدند.',
      'شناسه‌های GroupGuid به گروه‌های تفصیلی و کالایی آتی فرزام نگاشت شدند.',
    ],
    columns: [
      { key: 'code', labelFa: 'کد', isLtr: true },
      { key: 'name_fa', labelFa: 'نام / عنوان' },
      { key: 'identifier', labelFa: 'شناسه ملی / کالا', isLtr: true },
      { key: 'group_label', labelFa: 'گروه نگاشت‌شده' },
      { key: 'created_jalali', labelFa: 'تاریخ ثبت (شمسی)', isLtr: true },
    ],
    rows: parsedRows,
  };
}

/**
 * Format D: Fixed Assets (تجهیزات.xlsx)
 * - Computes both Book and Art. 149 Statutory Depreciation and disallowed excess
 */
function parseFixedAssetsSheet(matrix: unknown[][], fileName: string): ParsedExcelResult {
  const headers = (matrix[0] ?? []).map((h) => normalizePersianText(String(h ?? '')));
  const findCol = (regex: RegExp, fallback: number) => {
    const idx = headers.findIndex((h) => regex.test(h));
    return idx >= 0 ? idx : fallback;
  };

  const codeCol = findCol(/کد/, 0);
  const nameCol = findCol(/نام|شرح دارایی|تجهیز/, 1);
  const row149Col = findCol(/ردیف|ماده ۱۴۹|جدول/, 2);
  const costCol = findCol(/بهای تمام|ارزش|قیمت/, 3);
  const bookRateCol = findCol(/نرخ دفتری|دفتری/, 4);
  const statRateCol = findCol(/نرخ قانونی|نرخ ۱۴۹|نرخ مالیاتی|نرخ ماده/, 5);

  let flaggedRowsCount = 0;

  const parsedRows: ParsedExcelRow[] = matrix
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((row, i) => {
      const assetCode = toEnglishDigits(normalizePersianText(String(row[codeCol] ?? `FA-${i + 1}`)));
      const nameFa = normalizePersianText(String(row[nameCol] ?? ''));
      const art149Row = toEnglishDigits(normalizePersianText(String(row[row149Col] ?? '406')));
      const costRial = parseRialInteger(row[costCol] as string | number);
      const bookRate = Number(toEnglishDigits(String(row[bookRateCol] ?? '20'))) || 20;
      const statRate = Number(toEnglishDigits(String(row[statRateCol] ?? '12'))) || 12;

      const bookDepr = Math.trunc((costRial * bookRate) / 100);
      const statDepr = Math.trunc((costRial * statRate) / 100);
      const excess = Math.max(0, bookDepr - statDepr);

      const flags: string[] = [];
      if (excess > 0) {
        flaggedRowsCount += 1;
        flags.push(
          `مازاد استهلاک غیرقابل‌قبول ماده ۱۴۹ (ردیف ${art149Row}): ${excess.toLocaleString('en-US')} ریال`
        );
      }

      return {
        rowIndex: i + 2,
        severity: excess > 0 ? 'WARNING' : 'OK',
        flags,
        data: {
          asset_code: assetCode,
          name_fa: nameFa,
          art149_row: art149Row,
          cost_rial: costRial,
          book_rate_pct: `${bookRate}%`,
          statutory_rate_pct: `${statRate}%`,
          book_depr_rial: bookDepr,
          statutory_depr_rial: statDepr,
          excess_rial: excess,
        },
      };
    });

  return {
    format: 'FIXED_ASSETS',
    formatTitleFa: 'جدول دارایی‌های ثابت و استهلاک ماده ۱۴۹ (تجهیزات.xlsx)',
    fileName,
    detectedColumns: headers.length,
    totalRawRows: parsedRows.length,
    validRowsCount: parsedRows.length,
    excludedRowsCount: 0,
    flaggedRowsCount,
    metadataNotes: [
      'استهلاک دفتری و استهلاک قانونی بر اساس جدول ماده ۱۴۹ ق.م.م (از جمله ردیف ۴۰۶) محاسبه شد.',
      'تفاوت مازاد استهلاک جهت افشا در اظهارنامه مالیاتی عملکرد تفکیک شد.',
    ],
    columns: [
      { key: 'asset_code', labelFa: 'کد اموال', isLtr: true },
      { key: 'name_fa', labelFa: 'شرح دارایی' },
      { key: 'art149_row', labelFa: 'ردیف ۱۴۹', isLtr: true },
      { key: 'cost_rial', labelFa: 'بهای تمام‌شده', isNumeric: true },
      { key: 'book_depr_rial', labelFa: 'استهلاک دفتری', isNumeric: true },
      { key: 'statutory_depr_rial', labelFa: 'استهلاک قانونی', isNumeric: true },
      { key: 'excess_rial', labelFa: 'مازاد غیرقابل‌قبول', isNumeric: true },
    ],
    rows: parsedRows,
  };
}

/**
 * Format E: Trial Balance Files
 * - Runs comma-grouping OCR sanity checks (e.g. flagging 50412,530,000 -> 5,412,530,000)
 */
function parseTrialBalanceSheet(matrix: unknown[][], fileName: string): ParsedExcelResult {
  const headers = (matrix[0] ?? []).map((h) => normalizePersianText(String(h ?? '')));
  const findCol = (regex: RegExp, fallback: number) => {
    const idx = headers.findIndex((h) => regex.test(h));
    return idx >= 0 ? idx : fallback;
  };

  const codeCol = findCol(/کد معین|کد حساب|کد/, 0);
  const nameCol = findCol(/نام حساب|عنوان/, 1);
  const debCol = findCol(/گردش بدهکار|مانده بدهکار|بدهکار/, 2);
  const credCol = findCol(/گردش بستانکار|مانده بستانکار|بستانکار/, 3);

  const ocrCorrections: NonNullable<ParsedExcelResult['ocrCorrections']> = [];
  let flaggedRowsCount = 0;

  const parsedRows: ParsedExcelRow[] = matrix
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((row, i) => {
      const code = toEnglishDigits(normalizePersianText(String(row[codeCol] ?? '')));
      const nameFa = normalizePersianText(String(row[nameCol] ?? ''));
      const rawDeb = String(row[debCol] ?? '0');
      const rawCred = String(row[credCol] ?? '0');

      const debCheck = checkOcrCommaGrouping(rawDeb);
      const credCheck = checkOcrCommaGrouping(rawCred);
      const flags: string[] = [];

      if (debCheck.isSuspect && debCheck.reasonFa) {
        flags.push(`بدهکار: ${debCheck.reasonFa}`);
        if (debCheck.suggestedRial !== null && debCheck.suggestedFormatted) {
          ocrCorrections.push({
            rowIndex: i + 2,
            field: 'بدهکار',
            rawText: debCheck.rawText,
            suggestedValueRial: debCheck.suggestedRial,
            suggestedFormatted: debCheck.suggestedFormatted,
          });
        }
      }

      if (credCheck.isSuspect && credCheck.reasonFa) {
        flags.push(`بستانکار: ${credCheck.reasonFa}`);
        if (credCheck.suggestedRial !== null && credCheck.suggestedFormatted) {
          ocrCorrections.push({
            rowIndex: i + 2,
            field: 'بستانکار',
            rawText: credCheck.rawText,
            suggestedValueRial: credCheck.suggestedRial,
            suggestedFormatted: credCheck.suggestedFormatted,
          });
        }
      }

      if (flags.length > 0) flaggedRowsCount += 1;

      return {
        rowIndex: i + 2,
        severity: flags.length > 0 ? 'ERROR' : 'OK',
        flags,
        data: {
          account_code: code,
          name_fa: nameFa,
          debit_rial: debCheck.suggestedRial ?? debCheck.parsedRawRial,
          credit_rial: credCheck.suggestedRial ?? credCheck.parsedRawRial,
          raw_source: `${rawDeb} / ${rawCred}`,
        },
      };
    });

  return {
    format: 'TRIAL_BALANCE',
    formatTitleFa: 'تراز آزمایشی (با پایش خطای OCR و گروه‌بندی ویرگول)',
    fileName,
    detectedColumns: headers.length,
    totalRawRows: parsedRows.length,
    validRowsCount: parsedRows.length,
    excludedRowsCount: 0,
    flaggedRowsCount,
    ocrCorrections,
    metadataNotes: [
      'الگوریتم کنترل سلامت گروه‌بندی سه‌رقمی ارقام (OCR Comma-Grouping Sanity Check) اجرا شد.',
      ocrCorrections.length > 0
        ? `${ocrCorrections.length} خطای احتمالی OCR در ارقام تراز شناسایی و اصلاح پیشنهادی ارائه شد.`
        : 'هیچ خطای گروه‌بندی OCR در فایل تراز مشاهده نشد.',
    ],
    columns: [
      { key: 'account_code', labelFa: 'کد معین', isLtr: true },
      { key: 'name_fa', labelFa: 'عنوان حساب' },
      { key: 'debit_rial', labelFa: 'بدهکار (اصلاح‌شده)', isNumeric: true },
      { key: 'credit_rial', labelFa: 'بستانکار (اصلاح‌شده)', isNumeric: true },
      { key: 'raw_source', labelFa: 'مقدار خام فایل', isLtr: true },
    ],
    rows: parsedRows,
  };
}

/**
 * Generates authentic in-memory SheetJS workbooks for all 5 formats so users can
 * test real SheetJS parsing end-to-end immediately or download sample templates.
 */
export function buildSampleWorkbookBuffer(format: ExcelFormatType): {
  buffer: ArrayBuffer;
  fileName: string;
} {
  const wb = XLSX.utils.book_new();
  let rows: unknown[][] = [];
  let fileName = 'sample.xlsx';

  if (format === 'BANK_EGHTESAD_NOVIN') {
    fileName = 'Bank_Eghtesad_Novin_1404_Q2.xlsx';
    rows = [
      ['بانک اقتصاد نوین — شعبه میرداماد تهران'],
      ['نام صاحب حساب: بازرگانی توسعه تجارت آتی فرزام ایرانیان'],
      ['شماره حساب: 102-810-4419022-1', '', '', '', ''],
      ['ترتیب گزارش: نزولی', '', '', '', 'STATIC_E4_DO_NOT_READ_999999999'],
      ['بازه گزارش: 1404/04/01 تا 1404/06/31'],
      ['واحد پول: ریال'],
      [''],
      ['تاریخ', 'شماره پیگیری', 'شرح تراکنش', 'بستانکار (واریز)', 'بدهکار (برداشت)', 'مانده پس از تراکنش'],
      // Descending order (newest first) to verify automatic chronological reversal + continuity proof
      ['1404/06/28', '904882', 'پرداخت سپرده ۵٪ حسن انجام کار پروژه راهداری', 0, 120_000_000, 4_230_000_000],
      ['1404/06/15', '904711', 'واریز بابت تسویه فاکتور فروش شرکت پتروشیمی جم', 850_000_000, 0, 4_350_000_000],
      ['1404/05/29', '904501', 'پرداخت حقوق و دستمزد مرداد ماه پرسنل', 0, 320_000_000, 3_500_000_000],
      ['1404/04/12', '904109', 'واریز پیش‌دریافت مشتری بازرگانی کاوه', 420_000_000, 0, 3_820_000_000],
    ];
  } else if (format === 'MOADIAN_SALES' || format === 'MOADIAN_PURCHASES') {
    const isSales = format === 'MOADIAN_SALES';
    fileName = isSales ? 'Moadian_Sales_1404_32cols.xlsx' : 'Moadian_Purchases_1404_29cols.xlsx';
    const colCount = isSales ? 32 : 29;
    const baseHeaders = [
      'شماره منحصر به فرد مالیاتی',
      'تاریخ صدور',
      isSales ? 'نام خریدار' : 'نام فروشنده',
      'شناسه ملی',
      'مبلغ قبل از مالیات',
      'مالیات بر ارزش افزوده',
      'وضعیت صورتحساب',
    ];
    while (baseHeaders.length < colCount) {
      baseHeaders.push(`ستون_تکمیلی_${baseHeaders.length + 1}`);
    }
    const padRow = (vals: unknown[]) => {
      const r = [...vals];
      while (r.length < colCount) r.push('');
      return r;
    };
    rows = [
      baseHeaders,
      padRow([
        'A1B2C300404120001001',
        '1404/04/18',
        'شركت بازرگاني فولاد پارس (عربي)',
        '10102847561',
        1_800_000_000,
        180_000_000,
        'تایید شده',
      ]),
      padRow([
        'A1B2C300404120001002',
        '1404/05/05',
        'شركت صنايع شيميايي البرز',
        '10320491822',
        950_000_000,
        95_000_000,
        'رد شده',
      ]),
      padRow([
        'A1B2C300404120001003',
        '1404/05/20',
        'بازرگاني توسعه تجارت راد',
        '14007728190',
        400_000_000,
        40_000_000,
        'باطل شده',
      ]),
    ];
  } else if (format === 'CATALOG_PARTIES_PRODUCTS') {
    fileName = 'Customers_Products_Catalog_1404.xlsx';
    rows = [
      ['کد تفصیلی', 'نام طرف حساب / کالا', 'شناسه ملی / کالا', 'GroupGuid', 'CreatedDateOLE'],
      ['T-1041', 'شركت پتروشيمي جم', '10101938475', '9a1b2c3d-1001-4a00-8b01-000000000001', 45742],
      ['T-1042', 'شركت حمل و نقل جاده اي راهدار', '10320884712', '9a1b2c3d-1003-4a00-8b01-000000000003', 45810],
      ['P-2009', 'پمپ هيدروليك صنعتي مدل X90', '2720000148921', '7f4e5d6c-2001-4b00-9c02-000000000010', 45880],
    ];
  } else if (format === 'FIXED_ASSETS') {
    fileName = 'تجهیزات.xlsx';
    rows = [
      ['کد اموال', 'شرح دارایی ثابت', 'ردیف ماده ۱۴۹', 'بهای تمام شده (ریال)', 'نرخ دفتری', 'نرخ قانونی ۱۴۹'],
      ['FA-406-01', 'ناوگان خودروی حمل تجاری و کشنده (ردیف ۴۰۶)', '406', 3_200_000_000, 20, 12],
      ['FA-102-02', 'سرورهای مرکز داده و تجهیزات شبکه ERP', '102', 640_000_000, 25, 25],
      ['FA-301-03', 'تجهیزات اداری و مبلمان دفتر مرکزی', '301', 480_000_000, 10, 10],
    ];
  } else {
    fileName = 'Trial_Balance_1404_OCR_Check.xlsx';
    rows = [
      ['کد معین', 'عنوان حساب', 'مانده بدهکار', 'مانده بستانکار'],
      ['1100', 'موجودی نقد و بانک', '50412,530,000', '0'],
      ['1102', 'حساب‌های دریافتنی تجاری', '2,180,000,000', '0'],
      ['7101', 'فروش خالص کالا و خدمات', '0', '7,592,530,000'],
    ];
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { buffer: out, fileName };
}
