import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';
import clsx from 'clsx';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { useAuth } from '../../context/AuthContext';
import { useTutorial } from '../../context/TutorialContext';
import { SpotlightOverlay } from '../Tutorial/SpotlightOverlay';

const Header = ({ onMenuClick, isGlass }) => {
  return (
    <header className={clsx(
      "lg:hidden flex items-center gap-4 px-4 py-3",
      isGlass ? "border-b border-white/10" : "border-b border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]"
    )}>
      <button className={isGlass ? "text-gray-400 hover:text-white" : "text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]"} onClick={onMenuClick}>
        <Menu size={24} />
      </button>
      <div className="flex items-center gap-2">
        <div className={clsx("w-7 h-7 rounded flex items-center justify-center text-[#ffffff] font-bold text-xs", isGlass ? "bg-[var(--accent)]" : "bg-[var(--dp-accent)]")}>P</div>
        <span className={isGlass ? "font-bold text-white" : "font-bold text-[var(--dp-text-primary)]"}>Profit Tracker</span>
      </div>
    </header>
  );
};

const Shell = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { preferences } = useUiPreferences();
  const { user } = useAuth();
  const { start, active: tutorialActive, currentStep: tutorialStep } = useTutorial();
  const isGlass = preferences.style === 'glassmorphism-brown';

  // Auto-start tutorial on first login
  useEffect(() => {
    if (user && user.tutorial_seen === false) {
      const timer = setTimeout(() => start(), 800);
      return () => clearTimeout(timer);
    }
  }, [user, start]);

  // Tutorial steps that spotlight a sidebar item are invisible on mobile unless
  // the drawer is open (it's translate-x-full off-canvas by default there).
  // Force it open for those steps, closed for every other step. No-op on
  // desktop, where isSidebarOpen doesn't affect layout.
  useEffect(() => {
    if (tutorialActive) {
      setIsSidebarOpen(Boolean(tutorialStep?.target?.startsWith('sidebar-')));
    }
  }, [tutorialActive, tutorialStep]);

  return (
    /* Step 1 — shell uses h-screen + overflow-hidden so it truly fills the
       viewport and the sidebar + content scroll independently without
       causing body-level overflow. */
    <div className={clsx(
      "flex h-screen w-full overflow-hidden",
      isGlass && "bg-[#111315] text-[#e8e2d6]"
    )}>
      <Sidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        uiStyle={preferences.style}
      />

      {/* Main content column — flex-1 so it takes remaining width;
          min-w-0 prevents flex children from overflowing their container. */}
      <main className={clsx(
        "flex flex-col flex-1 min-w-0 overflow-hidden",
        isGlass
          ? "relative bg-[radial-gradient(ellipse_at_20%_20%,rgba(216,166,90,0.035)_0%,transparent_42%),radial-gradient(ellipse_at_80%_80%,rgba(125,140,160,0.035)_0%,transparent_42%),#111315] lg:pl-[76px]"
          : "bg-[var(--dp-bg)]"
      )}>
        {/* Mobile top bar — hidden on lg+ */}
        <Header onMenuClick={() => setIsSidebarOpen(true)} isGlass={isGlass} />

        {/* Content region. min-h-0 ensures the flex child can shrink so
            each page component controls its own scroll boundary.
            No overflow-y here — pages (Dashboard, Inventory, etc.) each
            have their own scroll container via h-full overflow-auto. */}
        <div className={clsx(
          "flex-1 min-h-0 overflow-hidden",
          isGlass
            ? "glass-workspace"
            : "carbon-workspace"
        )}>
          {children}
        </div>
      </main>
      <SpotlightOverlay />
    </div>
  );
};

export default Shell;
