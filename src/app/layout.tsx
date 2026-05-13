import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'L21 Buchungssystem',
  description: 'Intelligentes Buchungs- und Belegungssystem',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-slate-50 antialiased">
        {children}
      </body>
    </html>
  )
}
