import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { detectPlatform } from '../platform/capabilities.ts';

export function SettingsSection({ id, title, profileId, children, defaultOpen = false }: {
  id: string; title: string; profileId: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const key = `dagobert_settings_${JSON.stringify([detectPlatform().isNative ? 'ios' : 'web', profileId, id])}`;
  const read = () => { try { const value = localStorage.getItem(key); return value === null ? defaultOpen : value === 'open'; } catch { return defaultOpen; } };
  const [open, setOpen] = useState(read);
  useEffect(() => { setOpen(read()); }, [key]);
  const change = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(key, next ? 'open' : 'closed'); } catch { /* Keep the UI usable without storage. */ }
  };
  return <details data-settings-section={id} open={open} className="settings-section group min-w-0 max-w-full glass-surface rounded-3xl p-4 shadow-sm border border-ios-separator dark:border-ios-darkSeparator" onToggle={event => {
    if (event.target !== event.currentTarget) return;
    change(event.currentTarget.open);
  }}>
    <summary className="min-h-12 flex items-center justify-between gap-3 cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white" onClick={event => { event.preventDefault(); change(!open); }}>
      <span className="min-w-0 break-words">{title}</span><ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="min-w-0 pt-3 space-y-4">{children}</div>
  </details>;
}
