import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentTester - 智能体自动化测试平台",
  description: "面向智能体开发者的 Web 端质量测试工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gray-50">
        <header className="border-b bg-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-8">
                <Link href="/" className="text-lg font-bold text-gray-900">
                  AgentTester
                </Link>
                <nav className="flex items-center gap-6">
                  <Link href="/" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    新建任务
                  </Link>
                  <Link href="/tasks" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    任务列表
                  </Link>
                  <Link href="/agents" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    智能体列表
                  </Link>
                  <Link href="/templates" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                    模板管理
                  </Link>
                </nav>
              </div>
              <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                设置
              </Link>
            </div>
          </div>
        </header>
        <main className="flex-1">
          {children}
        </main>
      </body>
    </html>
  );
}
