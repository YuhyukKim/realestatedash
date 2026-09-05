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
    title: "JAYDEN RESEARCH | 내집어디",
    description:
      "공식 서울 아파트 단지 마스터에서 가격, 입주·준공년도, 직장 직통권, 인근역으로 찾고 실거래·지도·교통·학교를 비교하는 대시보드",
    openGraph: {
      title: "JAYDEN RESEARCH | 내집어디",
      description:
        "공식 서울 아파트 단지 마스터에서 직장·지하철·입주년도 조건으로 좁히고, 실거래·지도·교통·학교까지 비교하는 주거 대시보드",
      type: "website",
      images: [{ url: "/og-naejibeodi.png", width: 1717, height: 916 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "JAYDEN RESEARCH | 내집어디",
      description:
        "공식 서울 아파트 단지 마스터에서 직장·지하철·입주년도 조건으로 좁히고, 실거래·지도·교통·학교까지 비교하는 주거 대시보드",
      images: ["/og-naejibeodi.png"],
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
