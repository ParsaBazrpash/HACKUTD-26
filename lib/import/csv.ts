// A small linear CSV reader (RFC 4180). One pass over the text, no regex on file text.

export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 200;
export const MAX_CELL = 8192;

export type Row = Map<string, string>;

export type TableResult =
  | { ok: true; columns: string[]; rows: Row[] }
  | { ok: false; error: string };

function pickDelimiter(text: string): string {
  let inQuotes = false;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === '\n' || c === '\r') break;
      if (c in counts) counts[c] += 1;
    }
  }
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

export function parseCsv(text: string): TableResult {
  const delim = pickDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let inQuotes = false;
  let quotedCell = false;
  let overCell = false;

  const endCell = () => {
    record.push(cell);
    cell = '';
    quotedCell = false;
  };
  const endRecord = () => {
    endCell();
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"' && cell.length === 0 && !quotedCell) {
      inQuotes = true;
      quotedCell = true;
    } else if (c === delim) {
      endCell();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      if (records.length > MAX_ROWS + 1) return { ok: false, error: 'Too many rows (limit 5,000). Export a shorter time range.' };
    } else {
      cell += c;
    }
    if (cell.length > MAX_CELL) overCell = true;
    if (overCell) return { ok: false, error: 'A cell is longer than 8 KB. This does not look like an alert export.' };
    if (record.length > MAX_COLUMNS) return { ok: false, error: 'Too many columns (limit 200).' };
  }
  if (inQuotes) return { ok: false, error: 'The file ends inside a quoted value. Check the export.' };
  if (cell.length > 0 || record.length > 0) endRecord();

  if (records.length === 0) return { ok: false, error: 'The file has no rows.' };
  if (records.length - 1 > MAX_ROWS) return { ok: false, error: 'Too many rows (limit 5,000). Export a shorter time range.' };
  const header = records[0];
  if (header.length > MAX_COLUMNS) return { ok: false, error: 'Too many columns (limit 200).' };

  const columns: string[] = [];
  const seen = new Set<string>();
  header.forEach((h, idx) => {
    let name = h.trim().slice(0, 120) || `column ${idx + 1}`;
    while (seen.has(name)) name = `${name} (${idx + 1})`;
    seen.add(name);
    columns.push(name);
  });

  const rows: Row[] = [];
  for (let r = 1; r < records.length; r += 1) {
    const rec = records[r];
    if (rec.length > MAX_COLUMNS) return { ok: false, error: 'Too many columns (limit 200).' };
    const row: Row = new Map();
    for (let c = 0; c < columns.length; c += 1) row.set(columns[c], rec[c] ?? '');
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, error: 'The file has a header but no data rows.' };
  return { ok: true, columns, rows };
}
