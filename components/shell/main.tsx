export function Main({
  children,
  wide = false,
  bleed = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
  /** Full width with no padding: the page draws its own frame (the incident room and its sidebar). */
  bleed?: boolean;
}) {
  const frame = bleed ? "" : wide ? "mx-auto max-w-[1440px] px-4 py-6 sm:px-8" : "mx-auto max-w-6xl px-5 py-10 sm:px-8";
  return (
    <main id="content" className={`flex w-full min-w-0 flex-1 flex-col ${frame}`}>
      {children}
    </main>
  );
}
