import type { Metadata } from "next";
import "./globals.css";
import CookieBanner from "./components/cookie-banner";
import MwPackageListener from "./mw-package-listener";

export const metadata: Metadata = {
  metadataBase: new URL("https://motionwren.com"),
  title: { default: "MotionWren | Property videos from listing photos", template: "%s · MotionWren" },
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
      <body className="antialiased">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <script src="/studio/mw-loader.js" data-src="/studio/mw-studio.html" defer></script>
        <MwPackageListener />
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
