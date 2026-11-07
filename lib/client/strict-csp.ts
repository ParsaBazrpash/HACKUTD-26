// Strict-CSP support for the SpacetimeDB SDK (THREAT_MODEL T21).
//
// spacetimedb 2.14.1 (the latest release) builds its BSATN row and reducer
// codecs at runtime with `Function(...)` source strings (upstream issue
// clockworklabs/SpacetimeDB#4966). Under our production CSP
// (`script-src 'self' 'unsafe-inline'`, no 'unsafe-eval') the browser refuses
// that, so the real client cannot decode a single row.
//
// Instead of weakening script-src, this module swaps the four code generators
// (ProductType and SumType, serialize and deserialize) for closure-based
// versions that write and read exactly the same bytes. Every other code path
// goes through AlgebraicType.makeSerializer / makeDeserializer, which already
// use closures and which call these methods by property lookup, so replacing
// them here covers the whole SDK. Codecs are built lazily (on connect and on
// first use), so installing this before the first connection is enough.
//
// `installStrictCspCodecs()` runs on import; spacetime-backend.ts imports this
// module before the generated bindings. lib/client/strict-csp.test.ts checks
// that the stock SDK still needs eval, so it fails (and says to delete this
// shim) once an SDK upgrade stops using Function().
//
// Zod's own eval probe is switched off separately, in instrumentation-client.ts,
// because it fires while schemas are being defined, before this module loads.

import {
  AlgebraicType,
  ConnectionId,
  Identity,
  ProductType,
  SumType,
  TimeDuration,
  Timestamp,
  Uuid,
  type BinaryReader,
  type BinaryWriter,
} from 'spacetimedb';

type Ser = (writer: BinaryWriter, value: unknown) => void;
type De = (reader: BinaryReader) => unknown;
type ProductTy = Parameters<typeof ProductType.makeSerializer>[0];
type SumTy = Parameters<typeof SumType.makeSerializer>[0];
type Typespace = Parameters<typeof ProductType.makeSerializer>[1];

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// Same special single-field products the SDK maps to its own classes.
const SPECIAL_PRODUCTS: Record<string, De> = {
  __time_duration_micros__: (r) => new TimeDuration(r.readI64()),
  __timestamp_micros_since_unix_epoch__: (r) => new Timestamp(r.readI64()),
  __identity__: (r) => new Identity(r.readU256()),
  __connection_id__: (r) => new ConnectionId(r.readU128()),
  __uuid__: (r) => new Uuid(r.readU128()),
};

// Cached per type object, like the SDK. The cache entry is set before the
// field codecs are built, so recursive types resolve to the same function.
const productSer = new WeakMap<object, Ser>();
const productDe = new WeakMap<object, De>();
const sumSer = new WeakMap<object, Ser>();
const sumDe = new WeakMap<object, De>();

const isOptionShape = (ty: SumTy) =>
  ty.variants.length === 2 && ty.variants[0].name === 'some' && ty.variants[1].name === 'none';
const isResultShape = (ty: SumTy) =>
  ty.variants.length === 2 && ty.variants[0].name === 'ok' && ty.variants[1].name === 'err';

function makeProductSerializer(ty: ProductTy, typespace?: Typespace): Ser {
  const cached = productSer.get(ty);
  if (cached) return cached;
  const fields: { name: string; ser: Ser }[] = [];
  const ser: Ser = (writer, value) => {
    const v = value as Record<string, unknown>;
    for (const f of fields) f.ser(writer, v[f.name]);
  };
  productSer.set(ty, ser);
  for (const { name, algebraicType } of ty.elements) {
    fields.push({ name: name as string, ser: AlgebraicType.makeSerializer(algebraicType, typespace) as Ser });
  }
  Object.freeze(fields);
  return ser;
}

function makeProductDeserializer(ty: ProductTy, typespace?: Typespace): De {
  if (ty.elements.length === 0) return () => ({});
  if (ty.elements.length === 1) {
    const only = ty.elements[0].name as string;
    if (hasOwn(SPECIAL_PRODUCTS, only)) return SPECIAL_PRODUCTS[only];
  }
  const cached = productDe.get(ty);
  if (cached) return cached;
  const fields: { name: string; de: De }[] = [];
  const de: De = (reader) => {
    const result: Record<string, unknown> = {};
    for (const f of fields) result[f.name] = f.de(reader);
    return result;
  };
  productDe.set(ty, de);
  for (const { name, algebraicType } of ty.elements) {
    fields.push({ name: name as string, de: AlgebraicType.makeDeserializer(algebraicType, typespace) as De });
  }
  Object.freeze(fields);
  return de;
}

function makeSumSerializer(ty: SumTy, typespace?: Typespace): Ser {
  if (isOptionShape(ty)) {
    const some = AlgebraicType.makeSerializer(ty.variants[0].algebraicType, typespace) as Ser;
    return (writer, value) => {
      if (value !== null && value !== undefined) {
        writer.writeByte(0);
        some(writer, value);
      } else {
        writer.writeByte(1);
      }
    };
  }
  if (isResultShape(ty)) {
    const ok = AlgebraicType.makeSerializer(ty.variants[0].algebraicType, typespace) as Ser;
    const err = AlgebraicType.makeSerializer(ty.variants[1].algebraicType, typespace) as Ser;
    return (writer, value) => {
      const v = value as Record<string, unknown>;
      if ('ok' in v) {
        writer.writeU8(0);
        ok(writer, v.ok);
      } else if ('err' in v) {
        writer.writeU8(1);
        err(writer, v.err);
      } else {
        throw new TypeError('could not serialize result: object had neither a `ok` nor an `err` field');
      }
    };
  }
  const cached = sumSer.get(ty);
  if (cached) return cached;
  const byTag = new Map<string, { index: number; ser: Ser }>();
  const ser: Ser = (writer, value) => {
    const v = value as { tag: string; value: unknown };
    const variant = byTag.get(v.tag);
    if (!variant) throw new TypeError(`Could not serialize sum type; unknown tag ${v.tag}`);
    writer.writeByte(variant.index);
    variant.ser(writer, v.value);
  };
  sumSer.set(ty, ser);
  ty.variants.forEach(({ name, algebraicType }, index) => {
    byTag.set(name as string, { index, ser: AlgebraicType.makeSerializer(algebraicType, typespace) as Ser });
  });
  return ser;
}

function makeSumDeserializer(ty: SumTy, typespace?: Typespace): De {
  if (isOptionShape(ty)) {
    const some = AlgebraicType.makeDeserializer(ty.variants[0].algebraicType, typespace) as De;
    return (reader) => {
      const tag = reader.readU8();
      if (tag === 0) return some(reader);
      if (tag === 1) return undefined;
      throw new TypeError(`Can't deserialize an option type, couldn't find ${tag} tag`);
    };
  }
  if (isResultShape(ty)) {
    const ok = AlgebraicType.makeDeserializer(ty.variants[0].algebraicType, typespace) as De;
    const err = AlgebraicType.makeDeserializer(ty.variants[1].algebraicType, typespace) as De;
    return (reader) => {
      const tag = reader.readByte();
      if (tag === 0) return { ok: ok(reader) };
      if (tag === 1) return { err: err(reader) };
      throw new TypeError(`Can't deserialize a result type, couldn't find ${tag} tag`);
    };
  }
  const cached = sumDe.get(ty);
  if (cached) return cached;
  const variants: { tag: string; de: De }[] = [];
  const de: De = (reader) => {
    const index = reader.readU8();
    const variant = variants[index];
    // An unknown tag is corrupt input; fail closed instead of returning undefined.
    if (!variant) throw new TypeError(`Can't deserialize sum type, unknown variant ${index}`);
    return { tag: variant.tag, value: variant.de(reader) };
  };
  sumDe.set(ty, de);
  for (const { name, algebraicType } of ty.variants) {
    variants.push({ tag: name as string, de: AlgebraicType.makeDeserializer(algebraicType, typespace) as De });
  }
  Object.freeze(variants);
  return de;
}

let installed = false;

/** Replace the SDK's Function()-based codecs with closures. Idempotent. */
export function installStrictCspCodecs(): void {
  if (installed) return;
  Object.assign(ProductType, {
    makeSerializer: makeProductSerializer,
    makeDeserializer: makeProductDeserializer,
  });
  Object.assign(SumType, {
    makeSerializer: makeSumSerializer,
    makeDeserializer: makeSumDeserializer,
  });
  installed = true;
}

installStrictCspCodecs();
