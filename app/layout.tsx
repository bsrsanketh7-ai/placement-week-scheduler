import './globals.css';

export const metadata = {
  title: 'Placement Week Coordinator',
  description: 'Scheduling and live replanning for placement week',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
