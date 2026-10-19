import type { BankTemplate, ImportPreviewRow, CsvMetadata } from '../types/index.ts';

const FNV_PRIME_64 = 0x100000001b3n;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;

/**
 * True 64-bit FNV-1a hash using BigInt for collision-free deduplication
 */
export function computeTransactionHash(date: string, amount: number, rawText: string): string {
  const str = `${date}|${amount.toFixed(2)}|${rawText.trim()}`;
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & 0xffffffffffffffffn;
  }
  return `tx_${hash.toString(16).padStart(16, '0')}`;
}
/**
 * Legacy 32-bit hash fallback for deduplication of older records
 */
export function computeLegacyTransactionHash(date: string, amount: number, rawText: string): string {
  const str = `${date}|${amount.toFixed(2)}|${rawText.trim()}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'tx_' + Math.abs(hash).toString(36);
}


/**
 * Validates whether YYYY-MM-DD represents a real calendar day (rejects 31.02.)
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/**
 * Parses German date string "DD.MM.YYYY" to ISO "YYYY-MM-DD".
 * Strictly rejects malformed formats like "15oops.10.2026".
 */
export function parseGermanDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split('.');
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (!isValidCalendarDate(year, month, day)) return null;

  const dStr = String(day).padStart(2, '0');
  const mStr = String(month).padStart(2, '0');
  return `${year}-${mStr}-${dStr}`;
}

/**
 * Parses amount string to float. Supports German comma notation ("1.234,56", "-45,99")
 * AND JavaScript standard float notation ("12.34", "-1000.50").
 */
export function parseGermanAmount(amountStr: string): number | null {
  if (!amountStr) return null;
  const trimmed = amountStr.trim().replace(/€/g, '').replace(/\s+/g, '');
  if (!trimmed) return null;

  // 1. If it's already a JS float string with dot and NO comma (e.g. "12.34" or "-1000.50")
  if (/^-?\d+\.\d{1,4}$/.test(trimmed)) {
    const num = parseFloat(trimmed);
    return isNaN(num) ? null : num;
  }

  // 2. German notation: remove thousand-dots, convert comma to dot
  const cleaned = trimmed.replace(/\./g, '').replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Intelligent decomposition of comdirect's "Buchungstext" field.
 */
export function parseComdirectBuchungstext(raw: string): { payee: string; purpose: string } {
  if (!raw) return { payee: '', purpose: '' };
  const text = raw.trim();

  let payee = '';
  let purpose = '';

  const empfaengerMatch = text.match(
    /(?:Empfänger|Zahlungsempfänger):\s*([^;]+?)(?=(?:\s+(?:Kto\/IBAN|IBAN|BIC|BLZ|Buchungstext|Ref\.?|End-to-End-Ref\.?|Mandat|Gläubiger-ID|Glaeubiger-ID)(?::|\s)|$))/i
  );
  if (empfaengerMatch) {
    payee = empfaengerMatch[1].trim();
  }

  if (!payee) {
    const auftraggeberMatch = text.match(
      /Auftraggeber:\s*([^;]+?)(?=(?:\s+(?:Kto\/IBAN|IBAN|BIC|BLZ|Buchungstext|Ref\.?|End-to-End-Ref\.?|Mandat|Gläubiger-ID|Glaeubiger-ID)(?::|\s)|$))/i
    );
    if (auftraggeberMatch) {
      payee = auftraggeberMatch[1].trim();
    }
  }

  const zweckMatch = text.match(
    /(?:Buchungstext|Verwendungszweck|Notiz):\s*([^;]+?)(?=(?:\s+(?:Ref\.?|End-to-End-Ref\.?|Mandat|Gläubiger-ID|Kto\/IBAN|IBAN)(?::|\s)|$))/i
  );
  if (zweckMatch) {
    purpose = zweckMatch[1].trim();
  }

  if (!payee && !purpose) {
    const clean = text.replace(/\s+/g, ' ');
    payee = clean.slice(0, 40).trim();
    purpose = clean;
  } else if (!purpose) {
    purpose = text.replace(payee, '').replace(/(?:Empfänger|Auftraggeber):\s*/i, '').trim();
  } else if (!payee) {
    payee = purpose;
  }

  return { payee, purpose };
}

/**
 * Splits CSV line respecting quotes
 */
export function parseCsvLine(line: string, delimiter: string = ';'): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^["']|["']$/g, ''));
  return result;
}

/**
 * Main CSV parser supporting comdirect and generic templates
 */
export function parseBankCsv(
  content: string,
  template: BankTemplate,
  existingHashes: Set<string> = new Set()
): ImportPreviewRow[] {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  // Find header line
  let headerIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (lines[i].includes(template.headerIdentifier)) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(`Kopfzeile mit Kennung "${template.headerIdentifier}" nicht gefunden.`);
  }

  const headerCols = parseCsvLine(lines[headerIndex], template.delimiter);
  const colIndexMap: Record<string, number> = {};

  headerCols.forEach((col, idx) => {
    colIndexMap[col.trim()] = idx;
  });

  const reqCols = template.columns;
  const dateIdx = colIndexMap[reqCols.date];
  const amountIdx = colIndexMap[reqCols.amount];
  const textIdx = colIndexMap[reqCols.rawText];

  if (dateIdx === undefined || amountIdx === undefined || textIdx === undefined) {
    throw new Error(
      `Erforderliche Spalten nicht in CSV gefunden. Erwartet: ${reqCols.date}, ${reqCols.amount}, ${reqCols.rawText}`
    );
  }

  const typeIdx = reqCols.type ? colIndexMap[reqCols.type] : undefined;
  const valutaIdx = reqCols.valutaDate ? colIndexMap[reqCols.valutaDate] : undefined;

  const rows: ImportPreviewRow[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('Alter Kontostand') || line.startsWith('Neuer Kontostand')) {
      continue;
    }

    const cols = parseCsvLine(line, template.delimiter);
    if (cols.length < 3) continue;

    const rawDate = cols[dateIdx] || '';
    const rawAmount = cols[amountIdx] || '';
    const rawText = cols[textIdx] || '';
    const rawType = typeIdx !== undefined ? cols[typeIdx] || '' : '';
    const rawValuta = valutaIdx !== undefined ? cols[valutaIdx] || '' : '';

    const date = parseGermanDate(rawDate);
    if (!date) continue; // Skip lines with invalid calendar dates

    const amount = parseGermanAmount(rawAmount);
    if (amount === null) continue; // Skip lines with invalid amounts

    const valutaDate = rawValuta ? parseGermanDate(rawValuta) || undefined : undefined;

    let payee = '';
    let purpose = '';

    if (template.textParser === 'comdirect') {
      const parsed = parseComdirectBuchungstext(rawText);
      payee = parsed.payee;
      purpose = parsed.purpose;
    } else {
      payee = rawText.slice(0, 30);
      purpose = rawText;
    }

    const isPending = /vorgemerkt|offen/i.test(rawType);
    const status: 'booked' | 'pending' = isPending ? 'pending' : 'booked';

    const sourceHash = computeTransactionHash(date, amount, rawText);
    const legacyHash = computeLegacyTransactionHash(date, amount, rawText);
    const isDuplicate = existingHashes.has(sourceHash) || existingHashes.has(legacyHash);

    rows.push({
      date,
      valutaDate,
      type: rawType,
      payee: payee || rawType || 'Unbekannt',
      purpose: purpose || rawText,
      amount,
      category: 'sonstiges',
      rawText,
      sourceHash,
      isDuplicate,
      status
    });
  }

  return rows;
}

/**
 * Extracts comdirect metadata headers/footers (Zeitraum, Alter/Neuer Kontostand, IBAN).
 * Strictly scans ONLY pre-header lines (before the transaction table) and explicit
 * footer lines starting with "Alter/Neuer Kontostand". Never scans transaction lines!
 */
export function extractComdirectMetadata(content: string): CsvMetadata {
  const meta: CsvMetadata = {};
  const allLines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (allLines.length === 0) return meta;

  let headerIndex = -1;
  for (let i = 0; i < Math.min(allLines.length, 25); i++) {
    if (allLines[i].includes('Buchungstag')) {
      headerIndex = i;
      break;
    }
  }

  const preHeaderLines = headerIndex !== -1 ? allLines.slice(0, headerIndex) : allLines.slice(0, 10);
  const footerLines = allLines.filter(l => /^"?Alter Kontostand|^"?Neuer Kontostand/i.test(l));

  const metadataLines = [...preHeaderLines, ...footerLines];
  const metadataBlock = metadataLines.join('\n');

  // Zeitraum: DD.MM.YYYY - DD.MM.YYYY (supports colon, semicolon, quote, whitespace, 'vom ... bis')
  const zeitraumMatch = metadataBlock.match(
    /Zeitraum[^\d]*(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:-|bis)\s*(\d{1,2}\.\d{1,2}\.\d{4})/i
  );
  if (zeitraumMatch) {
    meta.startDate = parseGermanDate(zeitraumMatch[1]) || undefined;
    meta.endDate = parseGermanDate(zeitraumMatch[2]) || undefined;
  }

  // Fallback: Stand / per / Stichtag
  if (!meta.endDate) {
    const standMatch = metadataBlock.match(/(?:Stand|per|Stichtag|Datum)[":;\s]+(\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (standMatch) {
      meta.endDate = parseGermanDate(standMatch[1]) || undefined;
    }
  }

  // Neuer Kontostand & Date in Neuer Kontostand line
  for (const line of metadataLines) {
    if (/Neuer Kontostand/i.test(line)) {
      if (!meta.endDate) {
        const dateMatch = line.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
        if (dateMatch) {
          meta.endDate = parseGermanDate(dateMatch[1]) || undefined;
        }
      }
      const m = line.match(/Neuer Kontostand.*?([0-9.,-]+)\s*(?:EUR|€)/i) ||
                line.match(/Neuer Kontostand[^\d-]*([0-9.,-]+)/i);
      if (m && meta.newBalance === undefined) {
        const val = parseGermanAmount(m[1]);
        if (val !== null) {
          meta.newBalance = val;
        }
      }
    }
  }

  // Alter Kontostand
  for (const line of metadataLines) {
    if (/Alter Kontostand/i.test(line)) {
      const m = line.match(/Alter Kontostand.*?([0-9.,-]+)\s*(?:EUR|€)/i) ||
                line.match(/Alter Kontostand[^\d-]*([0-9.,-]+)/i);
      if (m && meta.oldBalance === undefined) {
        const val = parseGermanAmount(m[1]);
        if (val !== null) {
          meta.oldBalance = val;
        }
      }
    }
  }

  // IBAN
  const ibanMatch = metadataBlock.match(/(?:Konto|IBAN)[":;\s]+([A-Z]{2}[0-9A-Z]{10,30})/i);
  if (ibanMatch) {
    meta.iban = ibanMatch[1];
  }

  return meta;
}

/**
 * Decodes a File or Blob with explicit encoding (default Windows-1252)
 */
export async function decodeFileWithEncoding(file: File, encoding: string = 'windows-1252'): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    const decoder = new TextDecoder(encoding);
    return decoder.decode(buffer);
  } catch {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  }
}
