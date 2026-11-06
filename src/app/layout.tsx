import "./globals.css"
import React from "react";

export const metadata = {
  title: "ATELIER OS — AFAF EL ASSLI | نظام إدارة ورشة الخياطة والإنتاج والمبيعات",
  description: "Enterprise Couture & Workshop ERP for Maison AFAF EL ASSLI (عفاف الأصلي) — Algeria (DZD)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-[#FAF8F3] text-[#20232B] antialiased selection:bg-[#C99A3D]/20">
        {children}
      </body>
    </html>
  );
}
