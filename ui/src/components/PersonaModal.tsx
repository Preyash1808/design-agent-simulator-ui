'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type PersonaModalProps = {
  persona: {
    id: string;
    name: string;
    bio?: string;
  };
  isOpen: boolean;
  onClose: () => void;
};

type TabType = 'tea' | 'path' | 'emotion' | 'whatif';

export default function PersonaModal({ persona, isOpen, onClose }: PersonaModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('tea');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  const modalContent = (
    <div className="persona-modal-overlay" onClick={onClose}>
      <div className="persona-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="persona-modal-header">
          <div>
            <h2 className="persona-modal-title">{persona.name}</h2>
            {persona.bio && <p className="persona-modal-subtitle">{persona.bio}</p>}
          </div>
          <button className="persona-modal-close" onClick={onClose} aria-label="Close modal">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Content Area with Side Navigation */}
        <div className="persona-modal-body">
          {/* Right Side Navigation */}
          <nav className="persona-modal-nav">
            <button
              className={`persona-modal-nav-item ${activeTab === 'tea' ? 'active' : ''}`}
              onClick={() => setActiveTab('tea')}
            >
              TEA
            </button>
            <button
              className={`persona-modal-nav-item ${activeTab === 'path' ? 'active' : ''}`}
              onClick={() => setActiveTab('path')}
            >
              Path
            </button>
            <button
              className={`persona-modal-nav-item ${activeTab === 'emotion' ? 'active' : ''}`}
              onClick={() => setActiveTab('emotion')}
            >
              Emotion Composition
            </button>
            <button
              className={`persona-modal-nav-item ${activeTab === 'whatif' ? 'active' : ''}`}
              onClick={() => setActiveTab('whatif')}
            >
              What-if Simulations
            </button>
          </nav>

          {/* Main Content */}
          <div className="persona-modal-content">
            {activeTab === 'tea' && (
              <div className="persona-modal-tab-content">
                <h3 className="persona-modal-section-title">Think-Emote-Act (TEA)</h3>
                <p className="muted">Analysis of cognitive, emotional, and behavioral patterns for {persona.name}.</p>

                <div className="persona-modal-section">
                  <h4 className="persona-modal-subsection-title">Think</h4>
                  <p>Cognitive patterns and decision-making processes...</p>
                </div>

                <div className="persona-modal-section">
                  <h4 className="persona-modal-subsection-title">Emote</h4>
                  <p>Emotional responses and affective states...</p>
                </div>

                <div className="persona-modal-section">
                  <h4 className="persona-modal-subsection-title">Act</h4>
                  <p>Behavioral actions and interaction patterns...</p>
                </div>
              </div>
            )}

            {activeTab === 'path' && (
              <div className="persona-modal-tab-content">
                <h3 className="persona-modal-section-title">User Path</h3>
                <p className="muted">Journey mapping and interaction flow for {persona.name}.</p>

                <div className="persona-modal-section">
                  <p>Path visualization and key touchpoints will be displayed here...</p>
                </div>
              </div>
            )}

            {activeTab === 'emotion' && (
              <div className="persona-modal-tab-content">
                <h3 className="persona-modal-section-title">Emotion Composition</h3>
                <p className="muted">Emotional state breakdown and sentiment analysis for {persona.name}.</p>

                <div className="persona-modal-section">
                  <p>Emotion composition charts and metrics will be displayed here...</p>
                </div>
              </div>
            )}

            {activeTab === 'whatif' && (
              <div className="persona-modal-tab-content">
                <h3 className="persona-modal-section-title">What-if Simulations</h3>
                <p className="muted">Scenario testing and predictive modeling for {persona.name}.</p>

                <div className="persona-modal-section">
                  <p>Simulation results and scenarios will be displayed here...</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const overlayRoot = document.getElementById('overlay-root');
  return overlayRoot ? createPortal(modalContent, overlayRoot) : null;
}
