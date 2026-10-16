'use client';
import dynamic from 'next/dynamic';

const Home = dynamic(() => import('@/components/home/Home').then((m) => m.Home), { ssr: false, loading: () => <main className="home muted">Loading…</main> });

export function HomeClient() {
  return <Home />;
}
