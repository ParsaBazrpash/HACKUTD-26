import { describe, expect, test } from "vitest";
import { segmentHttpText } from "@/lib/links";

describe("http link splitting", () => {
  test("keeps non-http schemes as text and trims trailing punctuation", () => {
    expect(segmentHttpText("see javascript:alert(1) and https://example.com/a.")).toEqual([
      { kind: "text", value: "see javascript:alert(1) and " },
      { kind: "link", href: "https://example.com/a" },
      { kind: "text", value: "." },
    ]);
  });

  test("leaves an ordinary sentence untouched", () => {
    expect(segmentHttpText("No link here.")).toEqual([{ kind: "text", value: "No link here." }]);
  });
});
