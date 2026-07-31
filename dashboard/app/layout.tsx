import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'YIELD — Agentic CFO on Arc';
const DESCRIPTION =
  'Autonomous treasury agent on Arc testnet: verifiable identity, on-chain mandate, auditable decision receipts.';

export const metadata: Metadata = {
  metadataBase: new URL('https://dashboard-production-abea.up.railway.app'),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    siteName: 'YIELD',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
