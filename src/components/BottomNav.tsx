import React from 'react';
import { LayoutDashboard, ArrowLeftRight, Sparkles, Settings } from 'lucide-react';

export type NavTab = 'dashboard' | 'transactions' | 'rules' | 'settings';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  txCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, txCount }) => {
  const tabs = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transactions' as NavTab, label: 'Buchungen', icon: ArrowLeftRight, badge: txCount },
    { id: 'rules' as NavTab, label: 'Regeln', icon: Sparkles },
    { id: 'settings' as NavTab, label: 'Einstellungen', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-2xl bg-white/85 dark:bg-neutral-900/85 border-t border-ios-separator dark:border-ios-darkSeparator pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] transition-colors">
      <div className="max-w-md mx-auto flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              className={`flex-1 min-h-[48px] flex flex-col items-center justify-center relative py-1 transition-transform active:scale-90 ${
                isActive ? 'text-ios-tint font-semibold' : 'text-ios-gray hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2.5 px-1.5 py-0.2 min-w-4 text-[10px] font-bold rounded-full bg-ios-tint text-white flex items-center justify-center">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-1 tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
