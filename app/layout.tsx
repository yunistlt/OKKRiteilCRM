import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "OKKRiteilCRM",
    description: "RetailCRM and Telphin Analytics",
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
