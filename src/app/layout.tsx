import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible_Next, Atkinson_Hyperlegible_Mono, Courier_Prime } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// The interface face: one variable family with a width axis (titles expanded, text at normal width).
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin", "latin-ext"], axes: ["wdth"], display: "swap" });
// Fallback for scripts Archivo does not cover.
const atkinson = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin", "latin-ext"], display: "swap", adjustFontFallback: false });
const atkinsonMono = Atkinson_Hyperlegible_Mono({ variable: "--font-atkinson-mono", subsets: ["latin"], display: "swap", adjustFontFallback: false });
const courier = Courier_Prime({ variable: "--font-courier", subsets: ["latin", "latin-ext"], weight: ["400", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Knowlix: references you can trust", template: "%s · Knowlix" },
  description: "Knowlix checks every reference against real scholarly records and researches with you without ever inventing a source.",
  applicationName: "Knowlix",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b2a2e" },
    { media: "(prefers-color-scheme: dark)", color: "#030e0f" },
  ],
};

/* Applies the saved (or system) theme before first paint, so there is no flash. */
const themeScript = `(function(){try{var t=localStorage.getItem('knowlix-theme');if(t!=='light'&&t!=='dark'){t='light'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${archivo.variable} ${atkinson.variable} ${atkinsonMono.variable} ${courier.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
