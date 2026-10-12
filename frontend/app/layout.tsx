import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TripSync — AI Trip Planner",
  description:
    "Plan your next adventure with multi-agent AI-powered flight research, hotel discovery, personalized itineraries, and budget-aware recommendations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
