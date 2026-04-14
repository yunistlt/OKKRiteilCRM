import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import { Suspense } from 'react';
import { getSession } from '@/lib/auth';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';

export const metadata: Metadata = {
    title: "OKKRiteilCRM",
    description: "RetailCRM and Telphin Analytics",
    icons: {
        icon: "/favicon-v2.png",
        apple: "/favicon-v2.png",
    }
};

import Sidebar from "../components/ui/Sidebar";

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const session = await enrichSessionWithManagerIdentity(await getSession());

    return (
        <html lang="en">
            <body className="bg-gray-50 min-h-screen flex text-gray-900">
                <AuthProvider initialSession={session}>
                    <Suspense fallback={<div className="w-72 bg-gray-900 h-screen" />}>
                        <Sidebar />
                    </Suspense>
                    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative h-screen">
                        <Header />
                        <main className="flex-1 flex flex-col min-h-0 min-w-0 relative overflow-y-auto overflow-x-hidden">
                            {children}
                        </main>
                    </div>
                </AuthProvider>
            </body>
        </html>
    );
}
