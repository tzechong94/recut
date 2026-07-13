import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Recut — AI Showrunner',
  description: 'Every other tool gives you shots. Recut gives you a series.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
