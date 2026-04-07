import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Announcement from "../components/Announcement";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "野人相機 | Wildman Camera - LoamLab 出品",
  description: "讓直覺，領先於算力。為 SketchUp 深度打造的極致擬真引擎。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className="dark">
      <body className={`${inter.variable} antialiased bg-[#09090b] flex flex-col min-h-screen`}>
        <Announcement />
        {children}
      </body>
    </html>
  );
}
