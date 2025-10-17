"use client";
import { useEffect, useState } from 'react';

interface LoadingBarProps {
  show: boolean;
  message?: string;
}

export default function LoadingBar({ show, message = "Loading..." }: LoadingBarProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!show) {
      setProgress(0);
      return;
    }

    // Reset progress to 0 when showing
    setProgress(0);

    // Animate progress bar from 0 to 100% smoothly
    const startTime = Date.now();
    const duration = 2500; // 2.5 seconds total duration

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      
      setProgress(progress);
      
      if (progress < 100) {
        requestAnimationFrame(animate);
      } else {
        // Ensure we reach exactly 100%
        setProgress(100);
      }
    };

    requestAnimationFrame(animate);
  }, [show]);

  if (!show) return null;

  return (
    <div className="loading-bar-overlay">
      <div className="loading-bar-message">{message}</div>
      <div className="loading-bar-track">
        <div 
          className="loading-bar-fill" 
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
