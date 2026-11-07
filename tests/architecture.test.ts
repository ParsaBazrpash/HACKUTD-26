import { readFileSync, readdirSync, statSync } from "node:fs";
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

test("incident data has no API route or server action", () => {
  const files = ["app", "components", "hooks", "lib", "spacetimedb"].flatMap((dir) =>
    statSync(dir).isDirectory() ? sourceFiles(dir) : [],
  );
  const route = files.find((file) => file.endsWith(`${path.sep}route.ts`) || file.endsWith(`${path.sep}route.tsx`));
  expect(route).toBeUndefined();
  for (const file of files) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(/["']use server["']/);
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
  for (const file of ["lib/client/mock.ts", "lib/client/index.ts", "lib/scenario/clinic.ts"]) {
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
