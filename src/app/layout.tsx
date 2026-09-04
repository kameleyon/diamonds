import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { TopRail } from "@/components/top-rail";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Diamonds",
  description: "Personal betting terminal: find mispriced lines, size them, track the close.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="slate-grain min-h-full flex flex-col">
        <TopRail />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
