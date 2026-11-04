import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { getRepository } from '../data/repository.ts';
import { createRulesPackage, normalizeRulesPackage, planRulesImport, type RulesPackage, type RulesImportPlan } from '../data/rulesPackage.ts';
import { detectPlatform } from '../platform/capabilities.ts';

export function RulesTransfer({ profileId, onImported, initialFile, onClose }: {
  profileId: string; onImported: () => void | Promise<void>; initialFile?: File; onClose?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState<RulesPackage | null>(null);
  const [plan, setPlan] = useState<RulesImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function action(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Die Regeln-Datei konnte nicht verarbeitet werden.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function read(file: File) {
    setPayload(null); setPlan(null);
    if (file.size > 5 * 1024 * 1024) throw new Error('Die Regeln-Datei ist größer als 5 MB.');
    const data = normalizeRulesPackage(JSON.parse(await file.text()));
    const current = await getRepository().getProfileData(profileId);
    if (active.current) { setPayload(data); setPlan(planRulesImport(data, current.categories, current.rules)); }
  }
  useEffect(() => { if (initialFile) void action(() => read(initialFile)); }, [initialFile]);
  async function exportFile() {
    const repo = getRepository(), current = await repo.getProfileData(profileId);
    const data = createRulesPackage(current.categories, current.rules);
    if (detectPlatform().isNative) {
      if (!repo.shareRulesPackage) throw new Error('Die native Dateifreigabe fehlt.');
      await repo.shareRulesPackage(data); setNotice('Dateifreigabe geöffnet.');
    } else {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `dagobert_regeln_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Regeln und Kategorien exportiert.');
    }
  }
  async function commit() {
    if (!payload) return;
    const result = await getRepository().importRulesPackage(profileId, payload);
    if (!active.current) return;
    setPayload(null); setPlan(null);
    setNotice(`${result.rulesAdded} Regeln und ${result.categoriesAdded} Kategorien ergänzt. ${result.unchanged} Einträge waren bereits vorhanden.`);
    await onImported();
  }
  const content = <div className="space-y-3 min-w-0">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-sm">Regeln &amp; Kategorien übertragen</h3>
      {onClose && <button className="min-h-12 min-w-12" aria-label="Regeln-Import schließen" onClick={onClose} disabled={busy}><X className="w-5 h-5 mx-auto" /></button>}</div>
    <p className="text-sm text-ios-gray">Enthält alle Regeln und Kategorien, auch selbst angelegte. Buchungen, Konten und Profile bleiben beim Import unverändert. Alte Buchungen werden nicht automatisch neu kategorisiert.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="min-h-12 px-3 rounded-xl bg-ios-tint/10 text-ios-tint font-semibold text-sm flex items-center gap-2" disabled={busy} onClick={() => void action(exportFile)}><Download className="w-4 h-4" />Regeln und Kategorien exportieren</button>
      <button type="button" className="min-h-12 px-3 rounded-xl bg-ios-tint/10 text-ios-tint font-semibold text-sm flex items-center gap-2" disabled={busy} onClick={() => input.current?.click()}><Upload className="w-4 h-4" />Regeln und Kategorien importieren</button>
      <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Regeln-Datei auswählen" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void action(() => read(file)); }} />
    </div>
    {plan && <div className="p-3 rounded-xl bg-slate-100 dark:bg-neutral-800 space-y-2 text-sm">
      <p>{plan.rulesAdded} neue Regeln · {plan.categoriesAdded} neue Kategorien · {plan.unchanged} bereits vorhanden</p>
      <p>Vorhandene Definitionen bleiben erhalten. Abweichende Einträge werden als zusätzliche Kopie übernommen.</p>
      <button type="button" className="min-h-12 px-4 rounded-xl bg-ios-tint text-white font-semibold disabled:opacity-50" disabled={busy || (!plan.rulesAdded && !plan.categoriesAdded)} onClick={() => void action(commit)}>Regeln und Kategorien ergänzen</button>
      <button type="button" className="min-h-12 px-3 text-ios-gray" disabled={busy} onClick={() => { setPlan(null); setPayload(null); }}>Abbrechen</button>
    </div>}
    {busy && <p role="status" className="text-sm">Bitte warten …</p>}
    {notice && <p role="status" className="text-sm text-ios-green">{notice}</p>}
    {error && <p role="alert" className="text-sm text-ios-red">{error}</p>}
  </div>;
  return onClose ? <div className="glass-overlay fixed inset-0 z-50 p-3 bg-black/60 flex items-center justify-center">
    <div role="dialog" aria-modal="true" aria-label="Regeln und Kategorien importieren" className="glass-surface rounded-3xl p-5 max-w-2xl w-full max-h-[90dvh] overflow-y-auto">{content}</div>
  </div> : <section aria-label="Regeln und Kategorien übertragen" className="glass-surface rounded-3xl p-4 border border-ios-separator dark:border-ios-darkSeparator">{content}</section>;
}
