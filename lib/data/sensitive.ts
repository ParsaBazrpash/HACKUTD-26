const DENIED_FIELDS = new Set([
  "plaintext",
  "title",
  "summary",
  "body",
  "narrative",
  "description",
  "hostname",
  "privatekey",
  "channelkey",
  "keymaterial",
  "password",
  "secret",
  "displayname",
  "content",
  "message",
  "note",
  "counselnote",
  "key",
  "rawkey",
  "aeskey",
  "symmetrickey",
  "brief",
  "topic",
  "descriptor",
  "details",
]);

function canonicalField(field: string): string {
  return field.toLowerCase().replaceAll("_", "");
}

function visit(
  current: unknown,
  path: string,
  foundFields: string[],
  foundSecrets: string[],
  sealedOffenders: string[],
): void {
  if (typeof current === "string" && current.includes("PRIVATE KEY")) {
    foundSecrets.push(path);
  }

  if (Array.isArray(current)) {
    current.forEach((item, index) =>
      visit(item, `${path}[${index}]`, foundFields, foundSecrets, sealedOffenders),
    );
    return;
  }

  if (!current || typeof current !== "object") return;

  const record = current as Record<string, unknown>;
  if (record.provenance === "browser-sealed") {
    sealedOffenders.push(path);
  }

  for (const [key, child] of Object.entries(record)) {
    const next = `${path}.${key}`;
    if (DENIED_FIELDS.has(canonicalField(key))) {
      foundFields.push(next);
    }
    visit(child, next, foundFields, foundSecrets, sealedOffenders);
  }
}

export function findSensitiveFields(value: unknown): string[] {
  const foundFields: string[] = [];
  const foundSecrets: string[] = [];
  visit(value, "$", foundFields, foundSecrets, []);
  return [...foundFields, ...foundSecrets];
}

export function assertNoSensitiveFields(value: unknown): void {
  const found = findSensitiveFields(value);
  if (found.length > 0) {
    throw new Error(
      `Refusing incident plaintext or key material at ${found.join(", ")}`,
    );
  }
}

export function assertPrototypeFixtures(value: unknown): void {
  const sealedOffenders: string[] = [];
  visit(value, "$", [], [], sealedOffenders);
  if (sealedOffenders.length > 0) {
    throw new Error(
      `Prototype client cannot hold browser-sealed envelopes at ${sealedOffenders.join(", ")}`,
    );
  }
}
