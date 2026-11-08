export type CheckState = 'pass' | 'warn' | 'fail';

/** The checks that can stop an import. The other two lines are rules that always apply. */
export type FailedCheck = 'type' | 'limits';

export interface CheckLine {
  label: string;
  state: CheckState;
}

const TYPE = 'Plain text, not a binary file (program, archive, image or PDF)';
const FORMULAS = 'Spreadsheet formulas: host names starting with = + - @ are skipped, imported text starts with a fixed label';
const LIMITS = 'Within limits: 2 MB, 5,000 rows, 200 columns, 8 KB per cell';

/**
 * The basic file checks shown in the preview. Each line says only what the code does.
 * By the time a preview exists the file already passed the type and limit checks (a failure stops the import earlier
 * and shows `failedChecklist` instead).
 */
export function fileChecklist(input: { hiddenFound: boolean }): CheckLine[] {
  return [
    { label: TYPE, state: 'pass' },
    {
      label: input.hiddenFound ? 'Hidden or direction-changing characters found and removed' : 'No hidden or direction-changing characters found',
      state: input.hiddenFound ? 'warn' : 'pass',
    },
    { label: FORMULAS, state: 'pass' },
    { label: LIMITS, state: 'pass' },
  ];
}

/** The line shown with a red cross when that check refused the file. Only that line is shown, so nothing is claimed about the rest. */
export function failedChecklist(check: FailedCheck): CheckLine[] {
  return [{ label: check === 'type' ? TYPE : LIMITS, state: 'fail' }];
}
