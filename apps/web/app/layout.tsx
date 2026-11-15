import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Meta Workspace | จัดการข้อมูลและควบคุมโฆษณา",
  description: "ระบบจัดเก็บรายงานและควบคุม Meta ผ่าน Chrome Extension ในเครื่องของคุณ",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
