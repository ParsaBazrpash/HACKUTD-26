import { describe, expect, it } from 'vitest';
import { cleanFileName, cleanHost, cleanSeverity, cleanText, cleanTitle, defang, parseTime } from '@/lib/import/clean';
import { segmentHttpText } from '@/lib/links';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const noLink = (s: string) => segmentHttpText(s).every((p) => p.kind === 'text');

describe('cleaning text', () => {
  it('normalizes and strips control, bidi and zero-width characters', () => {
    expect(cleanText('  ＦＳ\u202e-01\u200b \u2066x\u2069  ', 50)).toBe('FS-01 x');
    expect(cleanText('a\nb\tc\r\nd', 50)).toBe('a b c d');
    expect(cleanText('a\u0000b\u0007c', 50)).toBe('abc');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
  });
});

describe('host names', () => {
  it('accepts plain host names', () => {
    for (const h of ['FS-CLINIC-01', 'srv_01.lakeside.local', 'LAKESIDE\\PC-7', 'Front desk (2)']) {
      expect(cleanHost(h)).toEqual({ ok: true, host: h });
    }
  });

  it('skips a host that is a URL, has a colon or slash, or markup', () => {
    for (const h of ['https://evil.example', 'evil.example/x', 'a:b', '<b>x</b>', 'a@b', '[click](x)', "x';drop", '']) {
      expect(cleanHost(h)).toEqual({ ok: false, reason: 'unsafe host name' });
    }
  });

  it('cleans right-to-left overrides and zero-width spaces so no look-alike survives', () => {
    const rlo = cleanHost('PC\u202e-01');
    expect(rlo).toEqual({ ok: true, host: 'PC-01' });
    const zw = cleanHost('F\u200bS\u200c-\u200d01\ufeff');
    expect(zw).toEqual({ ok: true, host: 'FS-01' });
    expect(cleanHost('\u2066FS-01\u2069')).toEqual({ ok: true, host: 'FS-01' });
  });

  it('skips every non-ASCII letter, so no look-alike of another system survives', () => {
    const unsafe = { ok: false, reason: 'unsafe host name' };
    expect(cleanHost('\u13ac\u13bb\u13a1-\u13aa\u13e2\u13e2-01')).toEqual(unsafe); // all Cherokee, looks like EHR-APP-01
    expect(cleanHost('\u0420\u0410\u0421\u0405-\u0406\u041c\u050c-01')).toEqual(unsafe); // all Cyrillic, looks like PACS-IMG-01
    expect(cleanHost('\u03a1\u0391\u03f9\u0405-\u0406\u039c-01')).toEqual(unsafe); // Greek plus Cyrillic, no Latin
    expect(cleanHost('FS-CLINIC-01'.replace('C', '\u0421'))).toEqual(unsafe);
    expect(cleanHost('PC-\u03b1')).toEqual(unsafe);
    expect(cleanHost('Рабочая станция')).toEqual(unsafe);
  });

  it('still reads full-width letters as ASCII through NFKC', () => {
    expect(cleanHost('\uff26\uff33-\uff23\uff2c\uff29\uff2e\uff29\uff23-01')).toEqual({ ok: true, host: 'FS-CLINIC-01' });
  });

  it('skips a host over 120 characters', () => {
    expect(cleanHost('h'.repeat(120)).ok).toBe(true);
    expect(cleanHost('h'.repeat(5000)).ok).toBe(false);
  });
});

describe('titles are defanged until no link is left', () => {
  const tricky = [
    'see https://evil.example now',
    'HtTpS://x and HTTP://Y',
    'hthttp://tp://y',
    'hhttps://ttps://z',
    'http://http://http://a',
    'ht\u200btp://zero.example',
    'ｈｔｔｐｓ://fullwidth.example',
    'https://a.example, http://b.example; (https://c.example)',
    'httpshttps://://q',
  ];
  for (const t of tricky) {
    it(`no link in ${JSON.stringify(t)}`, () => {
      const out = cleanTitle(t);
      expect(noLink(out)).toBe(true);
      expect(noLink(defang(out))).toBe(true);
    });
  }

  it('keeps the readable shape', () => {
    expect(cleanTitle('Beacon to https://evil.example/a')).toBe('Beacon to hxxps://evil.example/a');
    expect(cleanTitle('HTTP://X')).toBe('hxxp://X');
  });

  it('survives a long run of scheme fragments', () => {
    const out = cleanTitle('http'.repeat(100) + '://' + 'https://'.repeat(30));
    expect(noLink(out)).toBe(true);
  });
});

describe('severity and file names', () => {
  it('keeps short plain words only', () => {
    expect(cleanSeverity('High')).toBe('High');
    expect(cleanSeverity('4')).toBe('4');
    expect(cleanSeverity('<script>')).toBeNull();
    expect(cleanSeverity('https://x')).toBeNull();
    expect(cleanSeverity('a'.repeat(60))).toBeNull();
  });

  it('turns a file name into something that cannot hold a link or a path', () => {
    expect(cleanFileName('alerts.csv')).toBe('alerts.csv');
    expect(cleanFileName('C:\\temp\\a.csv')).toBe('C__temp_a.csv');
    expect(noLink(cleanFileName('https://evil.example/x.csv'))).toBe(true);
    expect(cleanFileName('a\nSource: x, sha256 ' + 'a'.repeat(64) + '. Unverified claim..csv')).not.toContain('\n');
    expect(cleanFileName('')).toBe('import');
    expect(cleanFileName('<img src=x>.csv')).toBe('_img src_x_.csv');
  });
});

describe('times', () => {
  it('reads ISO 8601 with zone, offset and fractions', () => {
    const z = parseTime('2026-11-08T02:13:05Z', NOW);
    expect(z).toMatchObject({ ok: true, iso: '2026-11-08T02:13:05.000Z', flags: [] });
    expect(parseTime('2026-11-08T02:13:05.250+05:30', NOW)).toMatchObject({ ok: true, iso: '2026-11-07T20:43:05.250Z' });
    expect(parseTime('2026-11-08 02:13:05-0600', NOW)).toMatchObject({ ok: true, iso: '2026-11-08T08:13:05.000Z' });
  });

  it('reads epoch seconds and milliseconds', () => {
    expect(parseTime('1794103985', NOW)).toMatchObject({ ok: true, iso: '2026-11-08T02:13:05.000Z' });
    expect(parseTime('1794103985123', NOW)).toMatchObject({ ok: true, iso: '2026-11-08T02:13:05.123Z' });
    expect(parseTime('1794103985.5', NOW)).toMatchObject({ ok: true, iso: '2026-11-08T02:13:05.500Z' });
  });

  it('treats a time with no zone as UTC and flags it', () => {
    const r = parseTime('2026-11-08 02:13:05', NOW);
    expect(r).toMatchObject({ ok: true, iso: '2026-11-08T02:13:05.000Z' });
    expect(r.ok && r.flags).toContain('no time zone, read as UTC');
  });

  it('skips a time more than five minutes in the future', () => {
    expect(parseTime('2026-11-09T12:00:00Z', NOW)).toEqual({ ok: false, reason: 'dated in the future' });
    expect(parseTime('2026-11-08T12:04:00Z', NOW).ok).toBe(true);
    expect(parseTime('2026-11-08T12:06:00Z', NOW).ok).toBe(false);
    expect(parseTime(String(NOW + 3_600_000), NOW).ok).toBe(false);
  });

  it('flags a time older than 30 days', () => {
    const r = parseTime('2026-09-09T00:00:00Z', NOW);
    expect(r.ok && r.flags).toContain('older than 30 days');
    const recent = parseTime('2026-10-20T00:00:00Z', NOW);
    expect(recent.ok && recent.flags).toEqual([]);
  });

  it('refuses nonsense, impossible dates and strings over 40 characters', () => {
    for (const t of ['', 'yesterday', '2026-02-31T00:00:00Z', '2026-13-01', '2026-11-08T25:00:00Z', '0', '99999999999999999999', 'x'.repeat(41), '2026-11-08T02:13:05Z'.repeat(3), '1999-01-01T00:00:00Z']) {
      expect(parseTime(t, NOW).ok, t).toBe(false);
    }
  });

  it('is fast on a hostile 40 character time', () => {
    const start = Date.now();
    parseTime('2026-11-08T02:13:05.' + '1'.repeat(19) + '+++', NOW);
    parseTime('1'.repeat(40), NOW);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('invisible format characters and file name length', () => {
  it('strips a soft hyphen and other format characters from titles', () => {
    expect(cleanTitle('ht­tps://evil.example')).toBe('hxxps://evil.example');
    expect(cleanText('a­b⁤c', 20)).toBe('abc');
  });

  it('keeps a file name within 100 UTF-16 units even for characters outside the BMP', () => {
    const name = cleanFileName('\u{10300}'.repeat(100));
    expect(name.length).toBeLessThanOrEqual(100);
  });
});
