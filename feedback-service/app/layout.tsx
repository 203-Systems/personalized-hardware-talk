import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "203 演讲协作服务",
  description: "匿名评论、页面标注与需求追踪。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
