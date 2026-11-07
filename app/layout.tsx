import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ZeroHour",
    template: "%s · ZeroHour",
  },
  description:
    "A sealed incident-response war room for the first 72 hours after a ransomware attack.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <Suspense
          fallback={
            <header className="border-b border-line bg-background" aria-hidden="true">
              <div className="mx-auto h-[4.25rem] w-full max-w-6xl" />
            </header>
          }
        >
          <SiteHeader />
        </Suspense>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
