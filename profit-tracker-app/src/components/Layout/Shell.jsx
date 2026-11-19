import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Menu } from 'lucide-react';
import clsx from 'clsx';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { useAuth } from '../../context/AuthContext';
import { useTutorial } from '../../context/TutorialContext';
import { SpotlightOverlay } from '../Tutorial/SpotlightOverlay';
import AnimatedLogo from '../UI/AnimatedLogo';
import PendingCashoutCommit from '../PendingCashoutCommit';

const Header = ({ isGlass }) => {
  return (
    <header className={clsx(
      "lg:hidden flex items-center gap-4 px-4 py-3",
      isGlass ? "border-b border-white/10" : "border-b border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]"
    )}>
      <div className="flex items-center gap-2">
        <AnimatedLogo size={28} label={null} />
        <span className={isGlass ? "font-bold text-white" : "font-bold text-[var(--dp-text-primary)]"}>Profit Tracker</span>
      </div>
    </header>
  );
};

// Tablet widths (768-1023px) have no bottom bar and no fixed sidebar, so the
// menu opens from a round button pinned to the bottom-right corner, within
// thumb reach, instead of a hamburger in the top bar.
const MenuFab = ({ onClick, isGlass, hidden }) => (
  <button
    type="button"
    aria-label="Open menu"
    aria-haspopup="dialog"
    onClick={onClick}
    className={clsx(
      "fixed right-5 z-40 hidden h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 md:flex lg:hidden",
      hidden && "md:hidden",
      isGlass ? "bg-[#d8a65a] text-[#111315]" : "bg-[var(--dp-accent-solid)] text-white"
    )}
    style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
  >
    <Menu size={24} aria-hidden="true" />
  </button>
);

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
    /* Step 1 — shell uses h-dvh + overflow-hidden so it truly fills the
       viewport and the sidebar + content scroll independently without
       causing body-level overflow. */
    <div className={clsx(
      "flex h-dvh w-full overflow-hidden",
      isGlass && "bg-[#111315] text-[#e8e2d6]"
    )}>
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to main content
      </a>

      <Sidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        uiStyle={preferences.style}
      />

      {/* Main content column — flex-1 so it takes remaining width;
          min-w-0 prevents flex children from overflowing their container. */}
      <main id="main-content" tabIndex={-1} className={clsx(
        "flex flex-col flex-1 min-w-0 overflow-hidden outline-none",
        isGlass
          ? "relative bg-[radial-gradient(ellipse_at_20%_20%,rgba(216,166,90,0.035)_0%,transparent_42%),radial-gradient(ellipse_at_80%_80%,rgba(125,140,160,0.035)_0%,transparent_42%),#111315] lg:pl-[76px]"
          : "bg-[var(--dp-bg)]"
      )}>
        {/* Mobile top bar — hidden on lg+ */}
        <Header isGlass={isGlass} />

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

        <BottomNav onMoreClick={() => setIsSidebarOpen(true)} isGlass={isGlass} />
      </main>
      <MenuFab onClick={() => setIsSidebarOpen(true)} isGlass={isGlass} hidden={isSidebarOpen} />
      <SpotlightOverlay />
      <PendingCashoutCommit />
    </div>
  );
};

export default Shell;
