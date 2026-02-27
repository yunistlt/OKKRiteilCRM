import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";

export const metadata: Metadata = {
    title: "OKKRiteilCRM",
    description: "RetailCRM and Telphin Analytics",
    icons: {
        icon: "/favicon-v2.png",
        apple: "/favicon-v2.png",
    }
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="bg-gray-50 min-h-screen flex flex-col text-gray-900">
                <Header />
                <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
                    {children}
                </main>
            </body>
        </html>
    );
}
