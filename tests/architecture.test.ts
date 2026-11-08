import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry === ".next") return [];
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(fullPath) ? [fullPath] : [];
  });
}

const uiRoots = ["app", "components", "hooks"];

test("only the pager routes exist and no server action is used", () => {
  const files = ["app", "components", "hooks", "lib", "spacetimedb"].flatMap((dir) =>
    statSync(dir).isDirectory() ? sourceFiles(dir) : [],
  );
  const routes = files
    .filter((file) => file.endsWith(`${path.sep}route.ts`) || file.endsWith(`${path.sep}route.tsx`))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
  const allowed = ["app/api/page/route.ts", "app/api/twilio/voice/route.ts", "app/api/twilio/sms/route.ts"];
  for (const route of routes) expect(allowed, `unexpected route ${route}`).toContain(route);
  for (const file of files) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(/["']use server["']/);
  }
});

test("the pager routes and library never touch incident data", () => {
  const roots = ["app/api", "lib/pager"].filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
  const banned = [
    "@/lib/client",
    "@/lib/scenario",
    "module_bindings",
    "@/lib/protocol/events",
    "@/lib/crypto/seal",
    "@/lib/crypto/store",
    "@/lib/crypto/vault",
    "@/lib/crypto/chain",
    "@/lib/crypto/verify",
  ];
  for (const file of roots.flatMap(sourceFiles)) {
    const text = readFileSync(file, "utf8");
    for (const needle of banned) {
      expect(text, `${file} contains ${needle}`).not.toContain(needle);
    }
  }
});

test("the UI reaches incident data only through the client and hook", () => {
  const banned = [
    "@/lib/crypto",
    "@/lib/data",
    "@/types",
    "@/lib/client/real",
    "@/lib/client/mock",
    "@/lib/client/fold",
    "@/lib/client/backend",
    "@/lib/client/spacetime-backend",
    "@/lib/scenario",
    "module_bindings",
    "use-incident-data",
    "dangerouslySetInnerHTML",
  ];
  for (const file of uiRoots.flatMap(sourceFiles)) {
    const text = readFileSync(file, "utf8");
    for (const needle of banned) {
      expect(text, `${file} contains ${needle}`).not.toContain(needle);
    }
  }
});

test("the mock and scenario do not import crypto or generated bindings", () => {
  const mockFiles = [
    "lib/client/mock.ts",
    "lib/client/index.ts",
    "lib/scenario/clinic.ts",
    "lib/scenario/org.ts",
    "lib/client/mock-org.ts",
  ].filter((file) => existsSync(file));
  for (const file of mockFiles) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toContain("@/lib/crypto");
    expect(text, file).not.toContain("module_bindings");
    expect(text, file).not.toContain("@/lib/data");
    expect(text, file).not.toContain("@/types");
  }
});

test("app, components, hooks, and lib do not import the old model", () => {
  const files = ["app", "components", "hooks", "lib"].flatMap(sourceFiles);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toContain("@/lib/data");
    expect(text, file).not.toContain("@/types");
    // Scanner tests name this sink. Shipped modules still cannot use it.
    if (!/\.test\.tsx?$/.test(file)) {
      expect(text, file).not.toContain("dangerouslySetInnerHTML");
    }
  }
});
