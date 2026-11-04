import React, { useState } from 'react';
import { X, User, Briefcase, Plus, Lock, Check, KeyRound, AlertCircle, Pencil } from 'lucide-react';
import type { Profile } from '../types/index.ts';
import { createProfile, unlockProfile, updateProfile } from '../lib/api.ts';
import { detectPlatform } from '../platform/capabilities.ts';

interface ProfileModalProps {
  isOpen: boolean;
  profiles: Profile[];
  activeProfileId: string;
  onClose: () => void;
  onSelectProfile: (profile: Profile) => void;
  onProfilesChanged: () => void | Promise<void>;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  profiles,
  activeProfileId,
  onClose,
  onSelectProfile,
  onProfilesChanged,
}) => {
  const usesDeviceLock = detectPlatform().isNative;
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('User');
  const [color, setColor] = useState('#0A84FF');
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // PIN unlock state for switching
  const [unlockTarget, setUnlockTarget] = useState<Profile | null>(null);
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockAction, setUnlockAction] = useState<'select' | 'rename'>('select');
  const [renameTarget, setRenameTarget] = useState<Profile | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  if (!isOpen) return null;

  const handleSelect = (p: Profile) => {
    if (p.id === activeProfileId) {
      onClose();
      return;
    }

    if (p.hasPin && !usesDeviceLock) {
      setUnlockAction('select');
      setUnlockTarget(p);
      setUnlockPin('');
      setUnlockError(null);
      return;
    }

    onSelectProfile(p);
    onClose();
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockTarget || isUnlocking) return;
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const ok = await unlockProfile(unlockTarget.id, unlockPin);
      if (ok) {
        if (unlockAction === 'rename') {
          setRenameTarget(unlockTarget); setRenameName(unlockTarget.name); setUnlockTarget(null); setUnlockPin(''); return;
        }
        onSelectProfile(unlockTarget);
        setUnlockTarget(null);
        onClose();
      } else {
        setUnlockError('Falsche PIN für dieses Profil.');
        setUnlockPin('');
      }
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsUnlocking(false);
    }
  };

  const startRename = (p: Profile) => {
    setRenameError('');
    if (p.hasPin && !usesDeviceLock && p.id !== activeProfileId) {
      setUnlockAction('rename'); setUnlockTarget(p); setUnlockPin(''); setUnlockError(null); return;
    }
    setRenameTarget(p); setRenameName(p.name);
  };
  const saveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || savingRename) return;
    const name = renameName.trim();
    if (!name || name.length > 100) { setRenameError('Bitte einen Namen mit 1 bis 100 Zeichen eingeben.'); return; }
    setSavingRename(true); setRenameError('');
    try { await updateProfile(renameTarget.id, { name }); await onProfilesChanged(); setRenameTarget(null); }
    catch (error) { setRenameError(error instanceof Error ? error.message : 'Das Profil konnte nicht umbenannt werden.'); }
    finally { setSavingRename(false); }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg('Bitte einen Profilnamen eingeben.');
      return;
    }
    if (!usesDeviceLock && pin && !/^\d{4,6}$/.test(pin)) {
      setErrorMsg('Die PIN muss 4 bis 6 Ziffern enthalten.');
      return;
    }

    try {
      const created = await createProfile(name.trim(), icon, color, usesDeviceLock ? undefined : pin.trim() || undefined);
      onProfilesChanged();
      onSelectProfile(created);
      setIsCreating(false);
      setName('');
      setPin('');
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Fehler beim Erstellen');
    }
  };

  const colors = ['#0A84FF', '#30D158', '#FF9F0A', '#FF375F', '#BF5AF2', '#64D2FF'];

  return (
    <div className="glass-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-modal="true" aria-label="Profile und Bereiche" className="glass-surface w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90dvh] overflow-y-auto space-y-5 border border-ios-separator dark:border-ios-darkSeparator">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <User className="w-5 h-5 text-ios-tint" />
            <span>Profile &amp; Bereiche</span>
          </h2>
          <button
            onClick={onClose}
            disabled={savingRename}
            aria-label="Schließen"
            className="min-w-12 min-h-12 rounded-full bg-slate-100 dark:bg-neutral-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unlock Target Profile Form */}
        {unlockTarget && (
          <div className="bg-slate-50 dark:bg-neutral-800 p-4 rounded-2xl space-y-3 border border-ios-tint/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-ios-tint" />
                <span>PIN für &bdquo;{unlockTarget.name}&ldquo;</span>
              </span>
              <button
                type="button"
                onClick={() => setUnlockTarget(null)}
                className="text-xs text-ios-gray hover:text-slate-900 dark:hover:text-white"
              >
                Abbrechen
              </button>
            </div>

            {unlockError && (
              <p className="text-xs text-ios-red">{unlockError}</p>
            )}

            <form onSubmit={handleUnlockSubmit} className="space-y-3">
              <input
                type="password"
                aria-label="Profil-PIN"
                autoFocus
                placeholder="Profil-PIN eingeben"
                value={unlockPin}
                onChange={(e) => setUnlockPin(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-neutral-700 rounded-xl text-center text-base tracking-widest font-mono outline-none border border-neutral-300 dark:border-neutral-600 focus:ring-2 focus:ring-ios-tint"
              />
              <button
                type="submit"
                disabled={!unlockPin.trim() || isUnlocking}
                className="w-full py-2.5 rounded-xl bg-ios-tint text-white font-semibold text-xs shadow-md disabled:opacity-40"
              >
                Entsperren &amp; Wechseln
              </button>
            </form>
          </div>
        )}

        {/* Profile List */}
        {renameTarget && <form onSubmit={saveRename} className="space-y-3">
          <label className="block text-sm font-semibold">Profil umbenennen<input autoFocus className="w-full min-w-0 min-h-12 mt-1 px-3 rounded-xl bg-slate-100 dark:bg-neutral-800 text-base" value={renameName} maxLength={100} required disabled={savingRename} onChange={e => setRenameName(e.target.value)} /></label>
          {renameError && <p role="alert" className="text-sm text-ios-red">{renameError}</p>}
          <button className="min-h-12 px-4 rounded-xl bg-ios-tint text-white" disabled={savingRename}>Namen speichern</button>
          <button type="button" className="min-h-12 px-4 text-ios-gray" disabled={savingRename} onClick={() => setRenameTarget(null)}>Abbrechen</button>
        </form>}
        {!isCreating && !unlockTarget && !renameTarget && (
          <div className="space-y-2">
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              return (
                <div key={p.id} className="flex gap-2 items-stretch min-w-0">
                <button
                  onClick={() => handleSelect(p)}
                  className={`min-w-0 flex-1 flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left ${
                    isActive
                      ? 'border-ios-tint bg-ios-tint/10 shadow-sm'
                      : 'border-transparent bg-slate-50 dark:bg-neutral-800 hover:bg-slate-100 dark:hover:bg-neutral-700/60'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-white font-bold shadow-sm"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.icon === 'Briefcase' ? <Briefcase className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                        <span className="min-w-0 break-words">{p.name}</span>
                        {p.hasPin && !usesDeviceLock && <Lock className="w-3.5 h-3.5 text-ios-gray" />}
                      </p>
                      <p className="text-[11px] text-ios-gray">
                        {p.isDefault ? 'Standard-Profil' : 'Eigenständiger Bereich'}
                      </p>
                    </div>
                  </div>

                  {isActive && <Check className="w-5 h-5 text-ios-tint" />}
                </button>
                <button type="button" className="min-h-12 min-w-12 px-2 text-ios-tint rounded-xl flex flex-col items-center justify-center text-[11px]" aria-label={`Profil ${p.name} umbenennen`} onClick={() => startRename(p)}><Pencil className="w-4 h-4" /><span>Umbenennen</span></button>
                </div>
              );
            })}

            <button
              onClick={() => setIsCreating(true)}
              className="w-full mt-2 py-3.5 px-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-neutral-700 hover:border-ios-tint text-slate-600 dark:text-slate-300 hover:text-ios-tint font-semibold text-xs flex items-center justify-center space-x-2 transition-all min-h-[48px]"
            >
              <Plus className="w-4 h-4" />
              <span>Neues Profil anlegen (z. B. Firma oder Familie)</span>
            </button>
          </div>
        )}

        {/* Create Profile Form */}
        {isCreating && (
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ios-gray uppercase">Neues Profil</span>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-xs text-ios-tint font-medium"
              >
                Zurück
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-ios-red/10 border border-ios-red/20 rounded-xl flex items-center gap-2 text-xs text-ios-red">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-ios-gray block mb-1">Profilname</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Firma, Freelance, Partner"
                className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-tint"
                autoFocus
              />
            </div>

            {/* Icon selection */}
            <div>
              <label className="text-xs font-semibold text-ios-gray block mb-1">Symbol</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIcon('User')}
                  className={`p-2.5 rounded-xl border flex items-center gap-1.5 text-xs font-medium ${
                    icon === 'User' ? 'border-ios-tint bg-ios-tint/10 text-ios-tint' : 'bg-slate-100 dark:bg-neutral-800'
                  }`}
                >
                  <User className="w-4 h-4" /> Privat / Person
                </button>
                <button
                  type="button"
                  onClick={() => setIcon('Briefcase')}
                  className={`p-2.5 rounded-xl border flex items-center gap-1.5 text-xs font-medium ${
                    icon === 'Briefcase' ? 'border-ios-tint bg-ios-tint/10 text-ios-tint' : 'bg-slate-100 dark:bg-neutral-800'
                  }`}
                >
                  <Briefcase className="w-4 h-4" /> Firma / Gewerbe
                </button>
              </div>
            </div>

            {/* Color selection */}
            <div>
              <label className="text-xs font-semibold text-ios-gray block mb-1">Farbe</label>
              <div className="flex gap-2">
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-2 ring-ios-tint' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Optional PIN */}
            {!usesDeviceLock && <div>
              <label className="text-xs font-semibold text-ios-gray block mb-1">Optionale PIN-Sperre</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ios-gray" />
                <input
                  type="password"
                  maxLength={6}
                  inputMode="numeric"
                  aria-label="Neue Profil-PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Leer lassen für keinen PIN-Schutz"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-tint font-mono"
                />
              </div>
              <p className="text-[10px] text-ios-gray mt-1">Schützt den Wechsel in dieses Profil vor fremden Blicken.</p>
            </div>}

            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-ios-tint text-white font-semibold text-sm shadow-md hover:brightness-110 active:scale-95 transition-all min-h-[48px]"
            >
              Profil anlegen
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
