import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import type { Profile } from '../types/index.ts';
import { unlockProfile } from '../lib/api.ts';

export function ProfileUnlock({ profile, onUnlocked }: { profile: Profile; onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (await unlockProfile(profile.id, pin)) {
        onUnlocked();
      } else {
        setError('Falsche PIN. Bitte erneut versuchen.');
        setPin('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto p-6 space-y-5 text-center">
      <Lock className="w-10 h-10 mx-auto text-ios-tint" />
      <h1 className="text-xl font-bold">{profile.name} ist gesperrt</h1>
      <p className="text-sm">Gib die Profil-PIN ein, um deine Buchungen zu öffnen.</p>
      {error && <p role="alert" className="text-sm text-ios-red">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          aria-label="Profil-PIN"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={e => setPin(e.target.value)}
          className="w-full min-h-[48px] px-4 rounded-xl bg-white dark:bg-neutral-800 border border-slate-300 dark:border-neutral-600 text-base text-center"
        />
        <button type="submit" disabled={!pin.trim() || isSubmitting}
          className="w-full min-h-[48px] px-4 rounded-xl bg-ios-tint text-white font-semibold disabled:opacity-50">
          {isSubmitting ? 'Wird entsperrt…' : 'Entsperren'}
        </button>
      </form>
    </div>
  );
}
