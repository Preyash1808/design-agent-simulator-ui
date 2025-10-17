"use client";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function SpinnerPortal({ show }: { show: boolean }) {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => {
    setEl(document.getElementById('overlay-root'));
  }, []);
  if (!show || !el) return null;
  return createPortal(
    <div className="spinner-overlay"><div className="spinner" /></div>,
    el
  );
}


