"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to Launch Usability Test page
    // That page already has logic to show welcome message if no projects exist
    router.replace('/create-run');
  }, [router]);

  return null;
}
