export function Main({ children }: { children: React.ReactNode }) {
  return (
    <main id="content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-10 sm:px-8">
      {children}
    </main>
  );
}
