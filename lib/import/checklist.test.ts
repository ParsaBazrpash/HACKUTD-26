import { describe, expect, it } from 'vitest';
import { fileChecklist } from './checklist';
import { scanText } from './read';

describe('file checklist', () => {
  it('passes everything for a clean file', () => {
    expect(fileChecklist({ hiddenFound: scanText('a,b\n1,2').found }).every((l) => l.state === 'pass')).toBe(true);
  });
  it('warns when hidden characters were found', () => {
    const lines = fileChecklist({ hiddenFound: scanText('a‮b').found });
    expect(lines.filter((l) => l.state === 'warn')).toHaveLength(1);
    expect(lines.some((l) => l.state === 'fail')).toBe(false);
  });
  it('makes no thoroughness claim in any label', () => {
    for (const l of fileChecklist({ hiddenFound: false })) expect(l.label).not.toMatch(/safe|virus|malware free|clean file/i);
  });
});
