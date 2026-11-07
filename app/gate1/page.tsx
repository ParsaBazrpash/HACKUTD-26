'use client';

// TEMPORARY Gate 1 page (docs/PLAN.md A1). Delete once the real client lands.
import dynamic from 'next/dynamic';

const Gate1 = dynamic(() => import('./gate1-client'), { ssr: false });

export default function Gate1Page() {
  return <Gate1 />;
}
