import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Trueward Search",
  description: "Remote US software-developer jobs, from several boards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
