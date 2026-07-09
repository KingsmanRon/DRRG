import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dr RG Makoane · Patient Onboarding",
  description: "Cash patient onboarding and register for Dr Refiloe G Makoane",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cg fill='%234e9d2d'%3E%3Ccircle cx='32' cy='18' r='15'/%3E%3Ccircle cx='46' cy='32' r='15'/%3E%3Ccircle cx='32' cy='46' r='15'/%3E%3Ccircle cx='18' cy='32' r='15'/%3E%3C/g%3E%3Ccircle cx='32' cy='32' r='12.5' fill='white'/%3E%3Ctext x='32' y='37.5' text-anchor='middle' font-family='system-ui,sans-serif' font-size='13' font-weight='700' fill='%23153f9e'%3ERG%3C/text%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
