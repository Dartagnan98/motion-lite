import type { Metadata } from 'next'
import './globals.css'
import { GeistSans } from 'geist/font/sans'
import { AppShell } from '@/components/AppShell'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'
import { ShortcutsHelp } from '@/components/ShortcutsHelp'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PwaBootstrap } from '@/components/pwa/PwaBootstrap'
import { ToastProvider } from '@/components/ui/Toast'
import { UndoToastProvider } from '@/components/ui/UndoToast'
import { UserProvider } from '@/lib/use-current-user'
import { seedIfEmpty } from '@/lib/db'
import { ensureAppStartup } from '@/lib/startup'

export const metadata: Metadata = {
  title: 'Motion Lite',
  description: 'Project & task management by CTRL',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try { seedIfEmpty() } catch (e) { console.error('[layout] seedIfEmpty failed:', e instanceof Error ? e.message : e) }
  try { ensureAppStartup() } catch (e) { console.error('[layout] ensureAppStartup failed:', e instanceof Error ? e.message : e) }

  return (
    <html lang="en" className={GeistSans.variable}>
      <head>
        <link rel="manifest" href="/manifest.json?v=8" />
        <link rel="icon" href="/icon.svg?v=2" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" />
        <meta name="theme-color" content="#131412" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Motion Lite" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
      </head>
      <body className="antialiased">
        <PwaBootstrap />
        <KeyboardShortcuts />
        <ShortcutsHelp />
        <ErrorBoundary>
          <UserProvider>
            <ToastProvider><AppShell>{children}</AppShell><UndoToastProvider /></ToastProvider>
          </UserProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
