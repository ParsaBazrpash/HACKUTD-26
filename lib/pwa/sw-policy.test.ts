import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const root = process.cwd();

function pngSize(relativePath: string): { width: number; height: number } {
  const buf = readFileSync(join(root, relativePath));
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("installable manifest and icons", () => {
  it("describes a standalone HAVEN app", () => {
    const web = manifest();
    expect(web.name).toBe("HAVEN");
    expect(web.short_name).toBe("HAVEN");
    expect(web.description).toBe("Secure Incident Response Workspace");
    expect(web.display).toBe("standalone");
    expect(web.start_url).toBe("/");
    expect(web.scope).toBe("/");
    expect(web.theme_color).toBe("#A3E635");
    expect(web.background_color).toBe("#09090B");
    const icons = web.icons ?? [];
    expect(icons).toContainEqual({
      src: "/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    });
    expect(icons).toContainEqual({
      src: "/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    });
    expect(icons).toContainEqual({
      src: "/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    });
  });

  it("ships square icons at the sizes browsers install", () => {
    expect(pngSize("public/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("public/favicon-32x32.png")).toEqual({ width: 32, height: 32 });
    expect(pngSize("public/favicon-16x16.png")).toEqual({ width: 16, height: 16 });
    expect(pngSize("public/icon-maskable-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
  });

  it("ships a favicon with 16 and 32 pixel images", () => {
    const ico = readFileSync(join(root, "app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt8(6)).toBe(16);
    expect(ico.readUInt8(7)).toBe(16);
    expect(ico.readUInt8(22)).toBe(32);
    expect(ico.readUInt8(23)).toBe(32);
  });
});

describe("service worker stores nothing (T37)", () => {
  const source = readFileSync(join(root, "public/sw.js"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("listens for fetches so the app can be installed, and does not answer them", () => {
    expect(code).toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(code).not.toMatch(/respondWith/);
    expect(code).not.toMatch(/caches\.open/);
    expect(code).not.toMatch(/\.put\s*\(/);
    expect(code).not.toMatch(/\.addAll\s*\(/);
    expect(code).not.toMatch(/\.add\s*\(/);
  });

  it("does not touch storage or incident resources", () => {
    expect(code).not.toMatch(/indexedDB|localStorage|sessionStorage/);
    expect(code).not.toMatch(/incidents|invite|envelope|ciphertext|\/api\//i);
  });

  it("drops caches left by an older worker when it activates", () => {
    expect(source).toMatch(/caches\.keys\s*\(/);
    expect(source).toMatch(/caches\.delete\s*\(/);
    expect(source).toMatch(/skipWaiting\s*\(/);
  });
});
