import React from 'react';
import { Upload, Plus, ChevronDown, RefreshCw } from 'lucide-react';
import type { Profile } from '../types/index.ts';

interface NavbarProps {
  activeProfile?: Profile;
  onOpenImport: () => void;
  onOpenNewManual: () => void;
  onOpenProfiles: () => void;
  actionsDisabled?: boolean;
  /** Stored comdirect access: the button opens the direct fetch and reads "Sync". */
  syncAvailable?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProfile,
  onOpenImport,
  onOpenNewManual,
  onOpenProfiles,
  actionsDisabled = false,
  syncAvailable = false,
}) => {
  return (
    <header className="glass-header sticky top-0 z-40 pt-[env(safe-area-inset-top,0px)] transition-colors">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 h-[60px] sm:h-[72px] flex items-center justify-between gap-2">
        {/* Left: Brand + Profile Switcher */}
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex items-center space-x-2.5">
            <img
              src="/icon-192.png"
              alt="Dagobert Icon"
              className="w-[48px] h-[48px] sm:w-[60px] sm:h-[60px] object-contain drop-shadow-sm shrink-0"
            />
            <span className="brand-title font-extrabold text-lg tracking-tight text-slate-900 dark:text-white hidden xs:inline">
              Dagobert
            </span>
          </div>

          {/* Profile Switcher Pill Button */}
          {activeProfile && (
            <button
              onClick={onOpenProfiles}
              className="flex items-center space-x-1.5 px-3 py-1 glass-pill rounded-full transition-all text-xs font-semibold text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-neutral-700/60 min-h-[44px] min-w-0"
              title="Profil wechseln"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: activeProfile.color || '#0A84FF' }}
              />
              <span className="max-w-[100px] truncate">{activeProfile.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-ios-gray" />
            </button>
          )}
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Quick Manual Entry */}
          <button
            onClick={onOpenNewManual}
            disabled={actionsDisabled}
            className="flex items-center justify-center space-x-1 px-3 py-1.5 glass-pill rounded-full text-xs font-semibold transition-colors min-h-[44px] min-w-[44px]"
            aria-label="Manuelle Buchung erfassen"
            title="Manuelle Buchung erfassen"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Neu</span>
          </button>

          {/* CSV Import Button */}
          <button
            onClick={onOpenImport}
            disabled={actionsDisabled}
            className="flex items-center justify-center space-x-1.5 px-3.5 py-1.5 glass-action-primary rounded-full text-xs font-semibold hover:brightness-110 active:scale-95 transition-all min-h-[44px]"
            title={syncAvailable ? 'Buchungen von comdirect synchronisieren' : 'Buchungen importieren'}
          >
            {syncAvailable ? <RefreshCw className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
            <span>{syncAvailable ? 'Sync' : 'Import'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
