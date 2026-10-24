import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MotionWren | Property videos from listing photos",
  description: "Professional real-estate videos created from listing photographs, with accurate motion, polished assembly and reliable delivery.",
  openGraph: {
    title: "MotionWren",
    description: "Professional property videos from listing photographs.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "MotionWren",
    description: "Professional property videos from listing photographs.",
    images: ["/og.png"],
  },
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
