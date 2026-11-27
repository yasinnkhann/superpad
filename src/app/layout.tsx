import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZeroPad — Zero-Knowledge Notepad++ for the Web",
  description:
    "Anonymous, client-side AES-256-GCM encrypted multi-tab notepad with CodeMirror 6, boolean block scanner, regex find & replace, split view, and encrypted cloud backups.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-[#0b0e14] text-[#e6edf3] font-sans antialiased selection:bg-[#264f78] selection:text-white overflow-hidden">
        {children}
      </body>
    </html>
  );
}
