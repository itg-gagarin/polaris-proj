import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Furniture BOM Studio',
  description: 'BOM-driven 3D editor with markup, team review lanes, meetings and AI optimize',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
