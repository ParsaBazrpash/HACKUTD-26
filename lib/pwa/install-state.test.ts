import { describe, expect, it } from "vitest";
import { installSurface, isIosDevice, isIosOtherBrowser } from "./install-state";

describe("install surface", () => {
  it("hides the control when the app is already installed", () => {
    expect(installSurface({ standalone: true, ios: true, promptAvailable: true })).toBe("standalone");
  });

  it("uses the browser prompt when the browser offers one", () => {
    expect(installSurface({ standalone: false, ios: true, promptAvailable: true })).toBe("prompt");
    expect(installSurface({ standalone: false, ios: false, promptAvailable: true })).toBe("prompt");
  });

  it("uses Home Screen instructions on iPhone and iPad", () => {
    expect(installSurface({ standalone: false, ios: true, promptAvailable: false })).toBe("ios");
  });

  it("does not pretend an unsupported browser can install", () => {
    expect(installSurface({ standalone: false, ios: false, promptAvailable: false })).toBe("unavailable");
  });
});

describe("iOS detection", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  it("recognizes iPhone, iPad, and iPadOS desktop agents", () => {
    expect(isIosDevice(iphone, "iPhone", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
  });

  it("does not treat a desktop Mac or Android phone as iOS", () => {
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(
      isIosDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36",
        "Linux armv8l",
        5,
      ),
    ).toBe(false);
  });

  it("separates Safari from other iOS browsers", () => {
    expect(isIosOtherBrowser(iphone)).toBe(false);
    expect(isIosOtherBrowser(`${iphone} CriOS/128.0.6613.98`)).toBe(true);
    expect(isIosOtherBrowser("Mozilla/5.0 (Android 14) Chrome/128.0.0.0")).toBe(false);
  });
});
