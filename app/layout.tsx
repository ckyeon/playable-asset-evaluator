import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Evaluator",
  description: "Local creative judgment memory for playable ad AI assets"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
