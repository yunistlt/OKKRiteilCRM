import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "./components/Header";
import { Suspense } from 'react';
import { getSession } from '@/lib/auth';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/access-control';
import { getEffectiveRoleCapabilities } from '@/lib/access-control-server';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';
import { getEffectiveRouteRules } from '@/lib/rbac-server';
import GlobalConsultantShell from '@/components/GlobalConsultantShell';
import PwaBootstrap from './components/PwaBootstrap';

export const viewport: Viewport = {
    themeColor: '#0f172a',
};

export const metadata: Metadata = {
    title: "OKKRiteilCRM",
    description: "RetailCRM and Telphin Analytics",
    applicationName: 'OKKRiteilCRM',
    manifest: '/manifest.webmanifest',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'OKKRiteilCRM',
    },
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
    const [sessionResult, permissionRulesResult, roleCapabilitiesResult] = await Promise.allSettled([
        enrichSessionWithManagerIdentity(await getSession()),
        getEffectiveRouteRules(),
        getEffectiveRoleCapabilities(),
    ]);

    const session = sessionResult.status === 'fulfilled' ? sessionResult.value : null;
    const permissionRules = permissionRulesResult.status === 'fulfilled' ? permissionRulesResult.value : [];
    const roleCapabilities = roleCapabilitiesResult.status === 'fulfilled' ? roleCapabilitiesResult.value : DEFAULT_ROLE_CAPABILITIES;

    if (sessionResult.status === 'rejected') {
        console.error('[RootLayout] Failed to resolve session:', sessionResult.reason);
    }

    if (permissionRulesResult.status === 'rejected') {
        console.error('[RootLayout] Failed to resolve permission rules:', permissionRulesResult.reason);
    }

    if (roleCapabilitiesResult.status === 'rejected') {
        console.error('[RootLayout] Failed to resolve role capabilities:', roleCapabilitiesResult.reason);
    }

    return (
        <html lang="en">
            <body className="bg-gray-50 min-h-screen flex text-gray-900">
                <AuthProvider initialSession={session} initialPermissionRules={permissionRules} initialRoleCapabilities={roleCapabilities}>
                    <PwaBootstrap />
                    <Suspense fallback={<div className="w-72 bg-gray-900 h-screen" />}>
                        <Sidebar />
                    </Suspense>
                    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative h-screen">
                        <Header />
                        <main className="flex-1 flex flex-col min-h-0 min-w-0 relative overflow-y-auto overflow-x-hidden">
                            <GlobalConsultantShell>{children}</GlobalConsultantShell>
                        </main>
                    </div>
                </AuthProvider>
            </body>
        </html>
    );
}
