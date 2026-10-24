import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frame Motion Studio",
  description: "Professional real-estate videos created from listing photographs, with smooth motion, branded details and reliable delivery.",
  openGraph: {
    title: "Frame Motion Studio",
    description: "Professional property videos from listing photographs.",
    images: ["https://framemotionstudio.storydezign.com/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Frame Motion Studio",
    description: "Professional property videos from listing photographs.",
    images: ["https://framemotionstudio.storydezign.com/og.png"],
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
