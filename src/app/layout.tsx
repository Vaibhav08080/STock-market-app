import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {Toaster} from "@/components/ui/sonner"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "Signalist";
const SITE_DESCRIPTION = "Realtime market overview, fast stock search, charts, technicals, and profiles in one modern dashboard.";
const COVER_IMAGE = "https://res.cloudinary.com/dawvvzwyw/image/upload/v1760788029/WhatsApp_Image_2025-10-18_at_17.16.55_1cadd301_amqxpd.jpg";
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: `${SITE_NAME} – Stock Market Dashboard`,
    template: `%s • ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "stocks",
    "market",
    "trading",
    "technical analysis",
    "market overview",
    "watchlist",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d11" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: COVER_IMAGE },
    ],
    shortcut: [
      { url: "/favicon.ico" },
    ],
    apple: [
      { url: COVER_IMAGE },
    ],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: `${SITE_NAME} – Stock Market Dashboard`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: COVER_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} preview`,
      },
    ],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} – Stock Market Dashboard`,
    description: SITE_DESCRIPTION,
    images: [COVER_IMAGE],
    creator: "@signalist",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
