import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "記録ノート | 家計簿・ペット・行動ログ",
  description: "テキストや写真から AI が分類し、Google スプレッドシートに保存します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${geistSans.variable} min-h-screen bg-zinc-100 antialiased`}>
        <noscript>
          <div className="p-4 text-center text-sm text-zinc-800">
            このアプリは JavaScript が必要です。ブラウザの設定で有効にしてください。
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
