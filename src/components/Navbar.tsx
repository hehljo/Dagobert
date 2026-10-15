import React from 'react';
import { Upload, Plus, Moon, Sun, Landmark } from 'lucide-react';

interface NavbarProps {
  onOpenImport: () => void;
  onOpenNewManual: () => void;
  isDark: boolean;
  onToggleDark: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenImport,
  onOpenNewManual,
  isDark,
  onToggleDark,
}) => {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/75 dark:bg-black/75 border-b border-ios-separator dark:border-ios-darkSeparator transition-colors">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo & Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-ios-tint flex items-center justify-center shadow-md shadow-ios-tint/20 text-white">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight tracking-tight text-slate-900 dark:text-white">
              Dagobert
            </h1>
            <p className="text-xs text-ios-gray font-medium">Smart Finance</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onToggleDark}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-neutral-800/80 transition-colors"
            title="Theme wechseln"
            aria-label="Theme wechseln"
          >
            {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
          </button>

          <button
            onClick={onOpenNewManual}
            className="hidden sm:flex items-center space-x-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Neu</span>
          </button>

          <button
            onClick={onOpenImport}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl text-sm font-semibold bg-ios-tint text-white shadow-sm hover:brightness-110 active:scale-95 transition-all"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden xs:inline">CSV Import</span>
          </button>
        </div>
      </div>
    </header>
  );
};
