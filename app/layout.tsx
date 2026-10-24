import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frame Motion | Property videos, made simple",
  description: "Send your property photos. We turn them into a polished, professionally reviewed real estate video.",
  openGraph: {
    title: "Frame Motion | Property videos, made simple",
    description: "Send your property photos. We create a polished real estate video for you.",
    images: ["https://framemotionstudio.storydezign.com/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Frame Motion | Property videos, made simple",
    description: "Send your property photos. We create a polished real estate video for you.",
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
