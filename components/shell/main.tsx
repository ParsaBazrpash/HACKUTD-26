export function Main({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const frame = wide
    ? "max-w-[1440px] px-4 py-6 sm:px-8"
    : "max-w-6xl px-5 py-10 sm:px-8";
  return (
    <main id="content" className={`mx-auto flex w-full min-w-0 flex-1 flex-col ${frame}`}>
      {children}
    </main>
  );
}
