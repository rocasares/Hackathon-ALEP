import type { Metadata } from 'next';
import Rail from '@/components/Rail';
import './globals.css';

export const metadata: Metadata = {
  title: 'PERITO',
  description: 'Conciliación bancaria local para estudios contables',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400&display=swap"
        />
      </head>
      <body>
        <div className="app">
          <Rail />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
