import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';
import clsx from 'clsx';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { useAuth } from '../../context/AuthContext';
import { useTutorial } from '../../context/TutorialContext';
import { SpotlightOverlay } from '../Tutorial/SpotlightOverlay';

const Header = ({ onMenuClick }) => {
  return (
    <header className="lg:hidden flex items-center gap-4 px-4 py-3 border-b border-white/10">
      <button className="text-gray-400 hover:text-white" onClick={onMenuClick}>
        <Menu size={24} />
      </button>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-[var(--accent)] flex items-center justify-center text-white font-bold text-xs">P</div>
        <span className="font-bold text-white">Profit Tracker</span>
      </div>
    </header>
  );
};

const Shell = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { preferences } = useUiPreferences();
  const { user } = useAuth();
  const { start } = useTutorial();
  const isGlass = preferences.style === 'glassmorphism-brown';
  const isCarbonWorkspace = !isGlass;

  // Auto-start tutorial on first login
  useEffect(() => {
    if (user && user.tutorial_seen === false) {
      const timer = setTimeout(() => start(), 800);
      return () => clearTimeout(timer);
    }
  }, [user, start]);

  return (
    <div className={clsx(
      "flex h-full w-full",
      isGlass && "bg-[#111315] text-[#e8e2d6]"
    )}>
      <Sidebar 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed} 
        uiStyle={preferences.style}
      />
      
        <main className={clsx(
          "flex-1 flex flex-col min-w-0 overflow-hidden",
          isGlass
            ? "relative bg-[radial-gradient(ellipse_at_20%_20%,rgba(216,166,90,0.035)_0%,transparent_42%),radial-gradient(ellipse_at_80%_80%,rgba(125,140,160,0.035)_0%,transparent_42%),#111315] lg:pl-[76px]"
            : "bg-[var(--bg-base)]"
        )}>
        <Header onMenuClick={() => setIsSidebarOpen(true)} />
        <div className={clsx(
          "flex-1 overflow-y-auto theme-scrollbar",
          isGlass ? "p-4 sm:p-6 lg:p-7" : "p-3 sm:p-4 lg:p-6",
          isGlass && "glass-workspace",
          isCarbonWorkspace && "carbon-workspace"
        )}>
          {children}
        </div>
      </main>
      <SpotlightOverlay />
    </div>
  );
};

export default Shell;
