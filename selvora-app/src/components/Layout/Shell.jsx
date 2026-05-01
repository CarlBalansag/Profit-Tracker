import React, { useState } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';
import clsx from 'clsx';

const Header = ({ onMenuClick }) => {
  return (
    <header className="lg:hidden flex items-center gap-4 px-4 py-3 border-b border-white/10">
      <button className="text-gray-400 hover:text-white" onClick={onMenuClick}>
        <Menu size={24} />
      </button>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">P</div>
        <span className="font-bold text-white">Profit Tracker</span>
      </div>
    </header>
  );
};

const Shell = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-full w-full">
      <Sidebar 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed} 
      />
      
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(20,20,30,0.4)_0%,transparent_40%)]">
        <Header onMenuClick={() => setIsSidebarOpen(true)} />
        <div className="flex-1 overflow-y-auto theme-scrollbar p-3 sm:p-4 lg:p-6">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Shell;
