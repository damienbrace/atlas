import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atlas",
  description: "Personal AI assistant: email, money, notes and decisions.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d11",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden font-sans">{children}</body>
    </html>
  );
}
