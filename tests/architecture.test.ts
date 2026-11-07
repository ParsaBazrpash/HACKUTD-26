import { readdirSync, readFileSync, statSync } from "node:fs";
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

test("incident data has no API route or server action", () => {
  const files = ["app", "components", "hooks", "lib", "types", "spacetimedb"].flatMap(sourceFiles);
  const route = files.find((file) => file.endsWith(`${path.sep}route.ts`) || file.endsWith(`${path.sep}route.tsx`));
  expect(route).toBeUndefined();

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toMatch(/["']use server["']/);
  }
});

test("the data client does not import plaintext domain types or crypto", () => {
  for (const file of sourceFiles("lib/data")) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toContain("@/types/domain");
    expect(text, file).not.toContain("@/lib/crypto");
  }
});
