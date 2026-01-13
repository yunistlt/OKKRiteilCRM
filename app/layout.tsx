import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";

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
            <body className="bg-gray-50 min-h-screen text-gray-900">
                <Header />
                <main className="min-h-screen">
                    {children}
                </main>
            </body>
        </html>
    );
}
