import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DRG Makoane — Patient register",
  description: "Cash patient onboarding and register for Dr Refiloe G Makoane",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='8' fill='%23064f36'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='Georgia,serif' font-size='34' fill='white'%3ED%3C/text%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
