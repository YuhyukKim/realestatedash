import type { Metadata } from "next";
import { SITE_TITLE, SITE_DESCRIPTION, siteOrigin } from "./site-config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  // Never derive canonical/share URLs from untrusted forwarded host headers.
  const origin = siteOrigin(process.env.PUBLIC_SITE_URL);
  const metadataBase = origin ? new URL(origin) : undefined;

  return {
    metadataBase,
    alternates: origin ? { canonical: origin + "/" } : undefined,
    title: SITE_TITLE,
    description:
      SITE_DESCRIPTION,
    openGraph: {
      title: SITE_TITLE,
      description:
        SITE_DESCRIPTION,
      type: "website",
      images: [{ url: "/og-naejibeodi.png", width: 1717, height: 916 }],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description:
        SITE_DESCRIPTION,
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
