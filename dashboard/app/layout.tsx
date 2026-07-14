import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YIELD — Agentic CFO on Arc',
  description:
    'Autonomous treasury agent on Arc testnet: verifiable identity, on-chain mandate, auditable decision receipts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
