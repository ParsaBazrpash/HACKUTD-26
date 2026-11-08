import { CARD_FOOTER, CARD_NO_FINGERPRINT, CARD_PURPOSE, CARD_REPLACE } from "@/components/org/break-glass-model";

const W = 1050;
const H = 660;
const SANS = "ui-sans-serif, system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const TEXT = "#f5f5f3";
const MUTED = "#9a9f9b";
const ACCENT = "#d8ff65";

export interface CardImageInput {
  orgName: string | null;
  address: string;
  adminFingerprint: string | null;
  qr: string | null;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  const out = lines.slice(0, maxLines);
  const clip = (value: string) => {
    let v = value;
    while (v.length > 1 && ctx.measureText(`${v}...`).width > maxWidth) v = v.slice(0, -1);
    return `${v}...`;
  };
  if (lines.length > maxLines) out[maxLines - 1] = clip(out[maxLines - 1]);
  else if (out.length > 0 && ctx.measureText(out[out.length - 1]).width > maxWidth) out[out.length - 1] = clip(out[out.length - 1]);
  return out;
}

/** Draws the card with fillText only. Nothing leaves the browser. */
export async function renderCardCanvas(input: CardImageInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#080a09";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#141716";
  ctx.strokeStyle = "#292d2a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(1, 1, W - 2, H - 2, 28);
  else ctx.rect(1, 1, W - 2, H - 2);
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText("HAVEN BREAK-GLASS CARD", 56, 84);

  ctx.font = `600 18px ${MONO}`;
  const chip = "NOT A KEY";
  const chipW = ctx.measureText(chip).width + 32;
  ctx.strokeStyle = "#292d2a";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(W - 56 - chipW, 56, chipW, 40, 20);
  else ctx.rect(W - 56 - chipW, 56, chipW, 40);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.fillText(chip, W - 56 - chipW + 16, 83);

  const leftW = 560;
  ctx.fillStyle = TEXT;
  ctx.font = `600 44px ${SANS}`;
  const heading = input.orgName?.trim() ? input.orgName : "Your HAVEN card";
  let y = 160;
  // One line may use the full width; two lines stay left of the QR.
  const headingLines = ctx.measureText(heading).width <= W - 112 ? [heading] : wrap(ctx, heading, leftW, 2);
  for (const line of headingLines) {
    ctx.fillText(line, 56, y);
    y += 54;
  }

  ctx.fillStyle = MUTED;
  ctx.font = `22px ${SANS}`;
  y -= 14;
  for (const line of wrap(ctx, CARD_PURPOSE, leftW, 2)) {
    ctx.fillText(line, 56, y);
    y += 30;
  }

  y = Math.max(y + 30, 270);
  ctx.fillStyle = MUTED;
  ctx.font = `20px ${SANS}`;
  ctx.fillText("HAVEN address", 56, y);
  ctx.fillStyle = TEXT;
  ctx.font = `26px ${MONO}`;
  y += 38;
  for (const line of wrap(ctx, input.address, leftW, 2)) {
    ctx.fillText(line, 56, y);
    y += 34;
  }

  y += 22;
  ctx.fillStyle = MUTED;
  ctx.font = `20px ${SANS}`;
  if (input.adminFingerprint) {
    ctx.fillText("Admin fingerprint", 56, y);
    ctx.fillStyle = TEXT;
    ctx.font = `26px ${MONO}`;
    y += 38;
    const parts = input.adminFingerprint.split(" ");
    const half = Math.ceil(parts.length / 2);
    for (const row of [parts.slice(0, half).join(" "), parts.slice(half).join(" ")]) {
      if (!row) continue;
      ctx.fillText(row, 56, y);
      y += 34;
    }
  } else {
    ctx.fillText("Admin fingerprint", 56, y);
    y += 34;
    for (const line of wrap(ctx, CARD_NO_FINGERPRINT, leftW, 3)) {
      ctx.fillText(line, 56, y);
      y += 28;
    }
  }

  if (input.qr) {
    try {
      const img = new Image();
      img.src = input.qr;
      await img.decode();
      const size = 220;
      const x = W - 56 - size;
      const top = 190;
      ctx.fillStyle = "#f5f5f3";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, top, size, size, 12);
      else ctx.rect(x, top, size, size);
      ctx.fill();
      ctx.drawImage(img, x, top, size, size);
      ctx.fillStyle = MUTED;
      ctx.font = `18px ${SANS}`;
      ctx.textAlign = "center";
      ctx.fillText("Opens the address only", x + size / 2, top + size + 30);
      ctx.textAlign = "left";
    } catch {
      // Draw the card without the QR.
    }
  }

  ctx.font = `22px ${SANS}`;
  const foot = [
    ...wrap(ctx, CARD_FOOTER, W - 112, 2).map((text) => ({ text, color: TEXT })),
    ...wrap(ctx, CARD_REPLACE, W - 112, 1).map((text) => ({ text, color: MUTED })),
  ];
  let fy = H - 48 - (foot.length - 1) * 30;
  for (const line of foot) {
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, 56, fy);
    fy += 30;
  }
  return canvas;
}

export type SaveResult = "saved" | "shared" | "cancelled";

export async function saveCardImage(input: CardImageInput): Promise<SaveResult> {
  const canvas = await renderCardCanvas(input);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("no image");
  const file = new File([blob], "haven-card.png", { type: "image/png" });
  if (window.matchMedia?.("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "HAVEN break-glass card" });
      return "shared";
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return "cancelled";
      throw cause;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "haven-card.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}
