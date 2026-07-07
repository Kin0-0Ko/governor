import type { Metadata } from 'next';
import { StoreProvider } from './StoreProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Governor Dashboard',
  description: 'Scraping cost control and budget monitoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="dark" style={{ colorScheme: 'dark' }}>
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
