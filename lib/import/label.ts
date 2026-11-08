// Recognizing imported entries again when they are shown (the "Imported, unverified" chip).
// This is a display hint only. The text is a signed claim by the importer, never a proof.

export interface ImportedSource {
  fileName: string;
  sha256: string;
}

const SOURCE_LINE = /^Source: ([^\n]{1,100}), sha256 ([0-9a-f]{64})\. Unverified claim\.$/;

export function sourceLine(fileName: string, sha256: string): string {
  return `Source: ${fileName}, sha256 ${sha256}. Unverified claim.`;
}

function parseSourceLine(line: string): ImportedSource | null {
  const m = SOURCE_LINE.exec(line);
  return m ? { fileName: m[1], sha256: m[2] } : null;
}

/** Timeline text: starts with "Imported: " and ends with a valid Source line. */
export function importedSource(text: string): ImportedSource | null {
  if (text.length > 4000 || !text.startsWith('Imported: ')) return null;
  const cut = text.lastIndexOf('\n');
  if (cut < 0) return null;
  return parseSourceLine(text.slice(cut + 1));
}

/** System notes of an imported system: exactly one Source line. */
export function importedNotesSource(notes: string): ImportedSource | null {
  if (notes.length > 400) return null;
  return parseSourceLine(notes);
}
