import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "ec2eat · 今日食咩好？",
  description: "你嘅私人香港搵食小幫手",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-HK">
      <body>
        <div className="shell">
          <header>
            <Link className="brand" href="/" aria-label="ec2eat 主頁">
              ec2eat<span className="brand-dot">●</span>
            </Link>
            <span className="header-note">少啲諗，多啲滋味。</span>
          </header>
          <main>{children}</main>
          <footer>
            <span>香港 · 好好食一餐</span>
            <Link href="/privacy">私隱</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
