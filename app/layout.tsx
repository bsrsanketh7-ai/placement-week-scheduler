import { Inter, JetBrains_Mono } from 'next/font/google';
import { themeBootScript } from './_components/ThemeToggle';
import './globals.css';
import './styles/landing.css';
import './styles/console.css';

// Self-hosted at build time, so the exported site still works with no network.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'Placement Week',
  description: 'Scheduling and live replanning for placement week',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
