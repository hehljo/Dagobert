import React from 'react';
import { LayoutDashboard, ArrowLeftRight, BarChart3, Sparkles, Settings } from 'lucide-react';

export type NavTab = 'dashboard' | 'transactions' | 'statistics' | 'rules' | 'settings';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  txCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, txCount }) => {
  const tabs = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transactions' as NavTab, label: 'Buchungen', icon: ArrowLeftRight, badge: txCount },
    { id: 'statistics' as NavTab, label: 'Statistik', icon: BarChart3 },
    { id: 'rules' as NavTab, label: 'Regeln', icon: Sparkles },
    { id: 'settings' as NavTab, label: 'Einstellungen', icon: Settings },
  ];

  return (
    <nav className="glass-dock w-full z-30 pt-1 pb-[env(safe-area-inset-bottom,0px)] transition-colors">
      <div className="grid grid-cols-5 items-center min-h-[56px] px-1 sm:px-3 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              data-active={isActive}
              className={`glass-nav-item min-w-0 flex flex-col items-center justify-center relative py-1.5 min-h-[50px] transition-transform active:scale-95 ${
                isActive ? 'text-ios-tint font-semibold' : 'text-ios-gray hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-105' : ''}`} />
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2.5 px-1.5 py-0.2 min-w-4 text-[10px] font-bold rounded-full bg-ios-tint text-white flex items-center justify-center">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] mt-0.5 tracking-tight font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
