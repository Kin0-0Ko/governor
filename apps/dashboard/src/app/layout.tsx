import type { Metadata } from 'next';
import { StoreProvider } from './StoreProvider';

export const metadata: Metadata = {
  title: 'Governor Dashboard',
  description: 'Scraping cost control and budget monitoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
