import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

// Premium, highly legible sans for UI
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

// Keep Geist Mono for numbers / code bits if needed
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forecast-Model",
  description:
    "Investor-ready dashboard with retention-driven LTV, Revenue, ROAS, and Margin forecasts over a 3-year horizon.",
  icons: { icon: "/favicon.ico" },
  themeColor: "#0b0b0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={[
          // fonts
          jakarta.variable,
          geistMono.variable,

          // layout + readability
          "min-h-screen",
          "antialiased",
          "text-neutral-100",

          // premium background with soft vignette
          "bg-neutral-950",
          "[background-image:radial-gradient(80%_50%_at_50%_0%,rgba(212,175,55,0.06),transparent_60%)]",

          // nicer font features + slightly tighter tracking for headlines
          "[font-feature-settings:'ss01','ss02','cv01','cv02']",
        ].join(" ")}
      >
        <div className="mx-auto max-w-7xl px-6">{children}</div>
      </body>
    </html>
  );
}
