// Regression test for the production CSP failure on Vercel
// ("Evaluating a string as JavaScript violates the Content Security Policy").
//
// 1. Under Node's --disallow-code-generation-from-strings (the same refusal a
//    browser applies without 'unsafe-eval'), the stock SDK codecs throw and the
//    patched ones work.
// 2. The patched codecs produce byte-identical BSATN and identical decoded
//    values to the SDK's own codecs, for every generated table row and reducer
//    argument type plus hand-built edge cases.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { config as zodConfig } from 'zod';
import {
  AlgebraicType,
  BinaryReader,
  BinaryWriter,
  ProductType,
  SumType,
  t,
  type AlgebraicTypeType,
} from 'spacetimedb';

import MyChannelsRow from '@/src/module_bindings/my_channels_table';
import MyCheckpointsRow from '@/src/module_bindings/my_checkpoints_table';
import MyEnvelopesRow from '@/src/module_bindings/my_envelopes_table';
import MyEventsRow from '@/src/module_bindings/my_events_table';
import MyIncidentsRow from '@/src/module_bindings/my_incidents_table';
import MyInvitesRow from '@/src/module_bindings/my_invites_table';
import MyJoinAttemptsRow from '@/src/module_bindings/my_join_attempts_table';
import MyMembersRow from '@/src/module_bindings/my_members_table';
import MyStatusRow from '@/src/module_bindings/my_status_table';
import AdmitMember from '@/src/module_bindings/admit_member_reducer';
import AppendEvent from '@/src/module_bindings/append_event_reducer';
import CreateIncident from '@/src/module_bindings/create_incident_reducer';
import CreateInvite from '@/src/module_bindings/create_invite_reducer';
import PostCheckpoint from '@/src/module_bindings/post_checkpoint_reducer';
import RedeemInvite from '@/src/module_bindings/redeem_invite_reducer';
import RevokeMember from '@/src/module_bindings/revoke_member_reducer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('SpacetimeDB SDK under a no-eval CSP', () => {
  it('stock SDK codecs need eval; patched codecs do not', () => {
    const script = `
      const sdk = await import('spacetimedb');
      const ty = sdk.t.object('Probe', { a: sdk.t.u32(), b: sdk.t.string(), c: sdk.t.option(sdk.t.bool()) }).algebraicType;
      let stock = 'ok';
      try { sdk.AlgebraicType.makeSerializer(ty); } catch (e) { stock = e.name; }
      await import('./lib/client/strict-csp.ts');
      const fresh = sdk.t.object('Probe2', { a: sdk.t.u32(), b: sdk.t.string(), c: sdk.t.option(sdk.t.bool()) }).algebraicType;
      const w = new sdk.BinaryWriter(16);
      sdk.AlgebraicType.makeSerializer(fresh)(w, { a: 7, b: 'hi', c: true });
      const back = sdk.AlgebraicType.makeDeserializer(fresh)(new sdk.BinaryReader(w.getBuffer()));
      console.log(JSON.stringify({ stock, back }));
    `;
    const res = spawnSync(
      process.execPath,
      ['--disallow-code-generation-from-strings', '--no-warnings', '--input-type=module', '-e', script],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim().split('\n').pop()!);
    // Proves the harness reproduces the browser failure; if the SDK ever drops
    // Function(), this becomes 'ok' and the shim can be deleted.
    expect(out.stock).toBe('EvalError');
    expect(out.back).toEqual({ a: 7, b: 'hi', c: true });
  });
});

describe('Zod under a no-eval CSP', () => {
  it('instrumentation-client turns off the Zod JIT probe before app code runs', async () => {
    await import('@/instrumentation-client');
    expect(zodConfig().jitless).toBe(true);
  });
});

// ---------- byte equivalence with the SDK's own codecs ----------

let seed = 0x2468ace;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};
const int = (n: number) => Math.floor(rand() * n);
const big = (bits: number, signed: boolean) => {
  let v = 0n;
  for (let i = 0; i < bits; i += 16) v = (v << 16n) | BigInt(int(0x10000));
  v &= (1n << BigInt(bits)) - 1n;
  return signed ? BigInt.asIntN(bits, v) : v;
};

function gen(ty: AlgebraicTypeType, depth = 0): unknown {
  switch (ty.tag) {
    case 'Bool': return rand() < 0.5;
    case 'I8': return int(256) - 128;
    case 'U8': return int(256);
    case 'I16': return int(65536) - 32768;
    case 'U16': return int(65536);
    case 'I32': return (int(0x100000000) | 0);
    case 'U32': return int(0x100000000);
    case 'I64': return big(64, true);
    case 'U64': return big(64, false);
    case 'I128': return big(128, true);
    case 'U128': return big(128, false);
    case 'I256': return big(256, true);
    case 'U256': return big(256, false);
    case 'F32': return Math.fround((rand() - 0.5) * 1e6);
    case 'F64': return (rand() - 0.5) * 1e12;
    case 'String': return Array.from({ length: int(12) }, () => String.fromCodePoint(32 + int(0x2000))).join('');
    case 'Array': {
      const n = depth > 3 ? 0 : int(4);
      if (ty.value.tag === 'U8') return Uint8Array.from({ length: int(40) }, () => int(256));
      return Array.from({ length: n }, () => gen(ty.value, depth + 1));
    }
    case 'Product': {
      const els = ty.value.elements;
      if (els.length === 1 && String(els[0].name).startsWith('__')) {
        // Special products (Identity, Timestamp, ...): build via the SDK's own decoder.
        const w = new BinaryWriter(64);
        AlgebraicType.makeSerializer(els[0].algebraicType)(w, gen(els[0].algebraicType, depth + 1));
        return AlgebraicType.makeDeserializer(ty)(new BinaryReader(w.getBuffer()));
      }
      return Object.fromEntries(els.map((e) => [e.name, gen(e.algebraicType, depth + 1)]));
    }
    case 'Sum': {
      const vs = ty.value.variants;
      if (vs.length === 2 && vs[0].name === 'some' && vs[1].name === 'none') {
        return rand() < 0.5 ? undefined : gen(vs[0].algebraicType, depth + 1);
      }
      if (vs.length === 2 && vs[0].name === 'ok' && vs[1].name === 'err') {
        return rand() < 0.5 ? { ok: gen(vs[0].algebraicType, depth + 1) } : { err: gen(vs[1].algebraicType, depth + 1) };
      }
      const v = vs[int(vs.length)];
      return { tag: v.name, value: gen(v.algebraicType, depth + 1) };
    }
    default:
      throw new Error(`no generator for ${ty.tag}`);
  }
}

const Color = t.enum('Color', { Red: t.unit(), Green: t.unit(), Rgb: t.object('Rgb', { r: t.u8(), g: t.u8(), b: t.u8() }) });
const CASES: Record<string, AlgebraicTypeType> = {
  myChannels: MyChannelsRow.algebraicType,
  myCheckpoints: MyCheckpointsRow.algebraicType,
  myEnvelopes: MyEnvelopesRow.algebraicType,
  myEvents: MyEventsRow.algebraicType,
  myIncidents: MyIncidentsRow.algebraicType,
  myInvites: MyInvitesRow.algebraicType,
  myJoinAttempts: MyJoinAttemptsRow.algebraicType,
  myMembers: MyMembersRow.algebraicType,
  myStatus: MyStatusRow.algebraicType,
  admitMember: t.row(AdmitMember).algebraicType,
  appendEvent: t.row(AppendEvent).algebraicType,
  createIncident: t.row(CreateIncident).algebraicType,
  createInvite: t.row(CreateInvite).algebraicType,
  postCheckpoint: t.row(PostCheckpoint).algebraicType,
  redeemInvite: t.row(RedeemInvite).algebraicType,
  revokeMember: t.row(RevokeMember).algebraicType,
  fixedSizeAllPrimitives: t.object('Fixed', {
    a: t.bool(), b: t.i8(), c: t.u8(), d: t.i16(), e: t.u16(), f: t.i32(), g: t.u32(),
    h: t.i64(), i: t.u64(), j: t.f32(), k: t.f64(), l: t.u128(), m: t.i256(),
  }).algebraicType,
  empty: t.object('Empty', {}).algebraicType,
  nested: t.object('Nested', {
    color: Color,
    colors: t.array(Color),
    maybe: t.option(t.array(t.object('Pair', { k: t.string(), v: t.option(t.i64()) }))),
    res: t.result(t.string(), t.u32()),
    when: t.timestamp(),
    who: t.identity(),
  }).algebraicType,
};

describe('patched codecs match the SDK byte for byte', () => {
  // Phase 1: stock SDK (eval is allowed in this test process).
  const samples = Object.entries(CASES).flatMap(([name, ty]) =>
    Array.from({ length: 25 }, (_, i) => {
      const value = gen(ty);
      const w = new BinaryWriter(64);
      AlgebraicType.makeSerializer(ty)(w, value);
      const bytes = w.getBuffer().slice();
      const decoded = AlgebraicType.makeDeserializer(ty)(new BinaryReader(bytes));
      return { label: `${name} #${i}`, ty, value, bytes, decoded };
    }),
  );
  const stockProduct = ProductType.makeSerializer;
  const stockSum = SumType.makeSerializer;

  it('installs over the stock codecs', async () => {
    await import('./strict-csp');
    expect(ProductType.makeSerializer).not.toBe(stockProduct);
    expect(SumType.makeSerializer).not.toBe(stockSum);
  });

  it('encodes and decodes every sample identically', async () => {
    await import('./strict-csp');
    expect(samples.length).toBeGreaterThan(400);
    for (const s of samples) {
      const w = new BinaryWriter(64);
      AlgebraicType.makeSerializer(s.ty)(w, s.value);
      expect(w.getBuffer(), s.label).toEqual(s.bytes);
      const reader = new BinaryReader(s.bytes);
      expect(AlgebraicType.makeDeserializer(s.ty)(reader), s.label).toEqual(s.decoded);
      expect(reader.remaining, s.label).toBe(0);
    }
  });

  it('rejects an unknown sum tag instead of returning undefined', async () => {
    await import('./strict-csp');
    const ty = t.enum('Lonely', { A: t.unit(), B: t.unit() }).algebraicType;
    expect(() => AlgebraicType.makeDeserializer(ty)(new BinaryReader(new Uint8Array([9])))).toThrow(TypeError);
    const w = new BinaryWriter(4);
    expect(() => AlgebraicType.makeSerializer(ty)(w, { tag: 'Z', value: {} })).toThrow(TypeError);
  });
});
