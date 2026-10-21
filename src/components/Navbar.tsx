import React from 'react';
import { Upload, Plus, ChevronDown } from 'lucide-react';
import type { Profile } from '../types/index.ts';

interface NavbarProps {
  activeProfile?: Profile;
  onOpenImport: () => void;
  onOpenNewManual: () => void;
  onOpenProfiles: () => void;
  actionsDisabled?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProfile,
  onOpenImport,
  onOpenNewManual,
  onOpenProfiles,
  actionsDisabled = false,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-ios-darkCard/80 backdrop-blur-md border-b border-ios-separator dark:border-ios-darkSeparator pt-[env(safe-area-inset-top,0px)] transition-colors">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Left: Brand + Profile Switcher */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <img
              src="/icon-192.png"
              alt="Dagobert Icon"
              className="w-8 h-8 rounded-xl shadow-sm object-cover"
            />
            <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white hidden xs:inline">
              Dagobert
            </span>
          </div>

          {/* Profile Switcher Pill Button */}
          {activeProfile && (
            <button
              onClick={onOpenProfiles}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200/80 dark:hover:bg-neutral-700/80 transition-all text-xs font-semibold text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-neutral-700/60 min-h-[36px]"
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
        <div className="flex items-center space-x-2">
          {/* Quick Manual Entry */}
          <button
            onClick={onOpenNewManual}
            disabled={actionsDisabled}
            className="flex items-center justify-center space-x-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-neutral-700 transition-colors min-h-[40px]"
            title="Manuelle Buchung erfassen"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Neu</span>
          </button>

          {/* CSV Import Button */}
          <button
            onClick={onOpenImport}
            disabled={actionsDisabled}
            className="flex items-center justify-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-ios-tint text-white shadow-sm hover:brightness-110 active:scale-95 transition-all min-h-[40px]"
            title="comdirect CSV importieren"
          >
            <Upload className="w-4 h-4" />
            <span>Import</span>
          </button>
        </div>
      </div>
    </header>
  );
};
