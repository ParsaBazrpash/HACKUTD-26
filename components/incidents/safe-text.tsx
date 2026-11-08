import { segmentHttpText } from "@/lib/links";

export function SafeText({ text }: { text: string }) {
  const parts = segmentHttpText(text);
  return parts.map((part, index) =>
    part.kind === "link" ? (
      <a
        key={index}
        href={part.href}
        rel="noopener noreferrer"
        className="break-all text-signal underline decoration-signal/40 underline-offset-2"
      >
        {part.href}
      </a>
    ) : (
      <span key={index}>{part.value}</span>
    ),
  );
}
