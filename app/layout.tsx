import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "서울 아파트 실거래가 배치표",
    description:
      "서울 아파트 실거래가를 가격대, 자치구, 전용면적별로 비교하고 엑셀로 내려받는 대시보드",
    openGraph: {
      title: "제이든 리서치 | 서울 아파트 실거래가",
      description: "10개 가격대로 읽는 서울 아파트 시장",
      type: "website",
      images: [{ url: "/og-cardnews.png", width: 1731, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "제이든 리서치 | 서울 아파트 실거래가",
      description: "10개 가격대로 읽는 서울 아파트 시장",
      images: ["/og-cardnews.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

