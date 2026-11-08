export type CheckState = 'pass' | 'warn' | 'fail';

export interface CheckLine {
  label: string;
  state: CheckState;
}

/**
 * The basic file checks shown in the preview. Each line says only what the code does.
 * By the time a preview exists the file already passed the type and limit checks (a failure stops the import earlier).
 */
export function fileChecklist(input: { hiddenFound: boolean }): CheckLine[] {
  return [
    { label: 'File starts like a text file (not a program, archive, image or PDF)', state: 'pass' },
    {
      label: input.hiddenFound ? 'Hidden or direction-changing characters found and removed' : 'No hidden or direction-changing characters found',
      state: input.hiddenFound ? 'warn' : 'pass',
    },
    { label: 'Spreadsheet formulas: host names starting with = + - @ are skipped, imported text starts with a fixed label', state: 'pass' },
    { label: 'Within limits: 2 MB, 5,000 rows, 200 columns', state: 'pass' },
  ];
}
