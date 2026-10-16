import type { BankTemplate, ImportPreviewRow } from '../types/index.ts';

/**
 * 64-bit FNV-1a hash for deterministic, collision-free deduplication
 */
export function computeTransactionHash(date: string, amount: number, rawText: string): string {
  const str = `${date}|${amount.toFixed(2)}|${rawText.trim()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);

    h2 ^= (code >> 8) ^ code;
    h2 = Math.imul(h2, 0x01000193);
  }

  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `tx_${p1}${p2}`;
}

/**
 * Validates whether YYYY-MM-DD represents a real calendar day (e.g. rejects 31.02.)
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/**
 * Parses German date string "DD.MM.YYYY" to ISO "YYYY-MM-DD", validating calendar validity
 */
export function parseGermanDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('.');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (!isValidCalendarDate(year, month, day)) return null;

    const dStr = String(day).padStart(2, '0');
    const mStr = String(month).padStart(2, '0');
    return `${year}-${mStr}-${dStr}`;
  }
  return null;
}

/**
 * Parses German number string (e.g. "1.234,56" or "-12,99") to float.
 * Returns null if invalid.
 */
export function parseGermanAmount(amountStr: string): number | null {
  if (!amountStr) return null;
  const cleaned = amountStr
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');

  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) {
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

  // Look for "Empfänger: XYZ" or "Zahlungsempfänger: XYZ"
  const empfaengerMatch = text.match(
    /(?:Empfänger|Zahlungsempfänger):\s*([^;]+?)(?=(?:\s+(?:Kto\/IBAN|IBAN|BIC|BLZ|Buchungstext|Ref\.|End-to-End-Ref|Mandat|Gläubiger-ID):|$))/i
  );
  if (empfaengerMatch) {
    payee = empfaengerMatch[1].trim();
  }

  // Look for "Auftraggeber: XYZ"
  if (!payee) {
    const auftraggeberMatch = text.match(
      /Auftraggeber:\s*([^;]+?)(?=(?:\s+(?:Kto\/IBAN|IBAN|BIC|BLZ|Buchungstext|Ref\.|End-to-End-Ref):|$))/i
    );
    if (auftraggeberMatch) {
      payee = auftraggeberMatch[1].trim();
    }
  }

  // Look for "Buchungstext: XYZ" or "Verwendungszweck: XYZ"
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
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
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
    const isDuplicate = existingHashes.has(sourceHash);

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

/**
 * Extracts comdirect metadata headers/footers (Zeitraum, Alter/Neuer Kontostand, IBAN)
 */
export function extractComdirectMetadata(content: string): import('../types/index.ts').CsvMetadata {
  const meta: import('../types/index.ts').CsvMetadata = {};

  // Zeitraum: DD.MM.YYYY - DD.MM.YYYY
  const zeitraumMatch = content.match(/Zeitraum:\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i);
  if (zeitraumMatch) {
    meta.startDate = parseGermanDate(zeitraumMatch[1]) || undefined;
    meta.endDate = parseGermanDate(zeitraumMatch[2]) || undefined;
  }

  // Neuer Kontostand
  const neuerMatch = content.match(/Neuer Kontostand[";\s]+([0-9.,-]+)\s*(?:EUR|€)?/i);
  if (neuerMatch) {
    const val = parseGermanAmount(neuerMatch[1]);
    if (val !== null) meta.newBalance = val;
  }

  // Alter Kontostand
  const alterMatch = content.match(/Alter Kontostand[";\s]+([0-9.,-]+)\s*(?:EUR|€)?/i);
  if (alterMatch) {
    const val = parseGermanAmount(alterMatch[1]);
    if (val !== null) meta.oldBalance = val;
  }

  // IBAN
  const ibanMatch = content.match(/(?:Konto|IBAN)[":;\s]+([A-Z]{2}[0-9A-Z]{10,30})/i);
  if (ibanMatch) {
    meta.iban = ibanMatch[1];
  }

  return meta;
}
