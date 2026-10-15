import type { BankTemplate, ImportPreviewRow } from '../types/index.ts';

/**
 * Fast deterministic hash for deduplication
 */
export function computeTransactionHash(date: string, amount: number, rawText: string): string {
  const str = `${date}|${amount.toFixed(2)}|${rawText.trim()}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return 'tx_' + Math.abs(hash).toString(36);
}

/**
 * Parses German number string (e.g. "1.234,56" or "-12,99" or " -45,00 ") to float
 */
export function parseGermanAmount(amountStr: string): number {
  if (!amountStr) return 0;
  // Remove currency signs, spaces, and thousand-separators (dots)
  const cleaned = amountStr
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parses German date string "DD.MM.YYYY" to ISO "YYYY-MM-DD"
 */
export function parseGermanDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.trim().split('.');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

/**
 * Intelligent decomposition of comdirect's "Buchungstext" field.
 * Extracts counterparty (Empfänger / Auftraggeber) and transaction purpose.
 */
export function parseComdirectBuchungstext(raw: string): { payee: string; purpose: string } {
  if (!raw) return { payee: '', purpose: '' };
  const text = raw.trim();

  let payee = '';
  let purpose = '';

  // Look for "Empfänger: XYZ" or "Zahlungsempfänger: XYZ"
  const empfaengerMatch = text.match(/(?:Empfänger|Zahlungsempfänger):\s*([^;]+?)(?=(?:\s+(?:Kto\/IBAN|IBAN|BIC|BLZ|Buchungstext|Ref\.|End-to-End-Ref|Mandat|Gläubiger-ID):|$))/i);
  if (empfaengerMatch) {
    payee = empfaengerMatch[1].trim();
  }

  // Look for "Auftraggeber: XYZ"
  if (!payee) {
    const auftraggeberMatch = text.match(/Auftraggeber:\s*([^;]+?)(?=(?:\s+(?:Kto\/IBAN|IBAN|BIC|BLZ|Buchungstext|Ref\.|End-to-End-Ref):|$))/i);
    if (auftraggeberMatch) {
      payee = auftraggeberMatch[1].trim();
    }
  }

  // Look for "Buchungstext: XYZ" or "Verwendungszweck: XYZ"
  const zweckMatch = text.match(/(?:Buchungstext|Verwendungszweck|Notiz):\s*([^;]+?)(?=(?:\s+(?:Ref\.?|End-to-End-Ref\.?|Mandat|Gläubiger-ID|Kto\/IBAN|IBAN)(?::|\s)|$))/i);
  if (zweckMatch) {
    purpose = zweckMatch[1].trim();
  }

  // Fallbacks if structured keys are absent (e.g. Card payment "Kartenverfügung")
  if (!payee && !purpose) {
    // Check if there is a company name or description at the start
    const clean = text.replace(/\s+/g, ' ');
    payee = clean.slice(0, 40).trim();
    purpose = clean;
  } else if (!purpose) {
    // Strip the payee from text and use rest as purpose
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

  // Verify required columns exist
  const reqCols = template.columns;
  const dateIdx = colIndexMap[reqCols.date];
  const amountIdx = colIndexMap[reqCols.amount];
  const textIdx = colIndexMap[reqCols.rawText];

  if (dateIdx === undefined || amountIdx === undefined || textIdx === undefined) {
    throw new Error(`Erforderliche Spalten nicht in CSV gefunden. Erwartet: ${reqCols.date}, ${reqCols.amount}, ${reqCols.rawText}`);
  }

  const typeIdx = reqCols.type ? colIndexMap[reqCols.type] : undefined;
  const valutaIdx = reqCols.valutaDate ? colIndexMap[reqCols.valutaDate] : undefined;

  const rows: ImportPreviewRow[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines or trailing summaries (comdirect has totals at the end)
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

    if (!rawDate || !rawAmount) continue;

    const date = parseGermanDate(rawDate);
    const valutaDate = rawValuta ? parseGermanDate(rawValuta) : undefined;
    const amount = parseGermanAmount(rawAmount);

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
      isDuplicate
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
    // Fallback
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(buffer);
  }
}
