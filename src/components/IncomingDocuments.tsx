import { useEffect, useRef, useState } from 'react';
import type { Account, BankTemplate, Category, CategoryRule, Transaction } from '../types/index.ts';
import type { IncomingDocument } from '../data/interfaces.ts';
import { getRepository } from '../data/repository.ts';
import { BackupImportModal } from './BackupImportModal.tsx';
import { ImportModal } from './ImportModal.tsx';
import { APP_UNLOCKED_EVENT, isAppLockedError } from '../platform/appAccess.ts';
import { RulesTransfer } from './RulesTransfer.tsx';

export function IncomingDocuments(props: { profileId: string; profileName: string; transactions: Transaction[];
  accounts: Account[]; bankTemplates: BankTemplate[]; categories: Category[]; rules: CategoryRule[]; onImported: () => void }) {
  const [documents, setDocuments] = useState<IncomingDocument[]>([]);
  const [selected, setSelected] = useState<(IncomingDocument & { file: File; rulesOnly: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const imported = useRef(false);
  const refreshAction = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const repo = getRepository();
    if (!repo.getIncomingDocuments) return;
    let active = true, reading = false, unsubscribe: (() => void) | undefined;
    const refresh = async () => {
      if (document.hidden || reading) return;
      reading = true;
      try { const list = await repo.getIncomingDocuments!(); if (active) { setDocuments(list); setError(null); } }
      catch (error) { if (active) setError(isAppLockedError(error) ? null : 'Geöffnete Dateien konnten nicht gelesen werden. Bitte erneut versuchen.'); }
      finally { reading = false; }
    };
    refreshAction.current = refresh;
    void refresh();
    repo.onIncomingDocumentsChanged?.(refresh).then(remove => { if (active) unsubscribe = remove; else remove(); }).catch(() => {});
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener(APP_UNLOCKED_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; refreshAction.current = undefined; unsubscribe?.(); window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener(APP_UNLOCKED_EVENT, refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const open = async (id: string) => {
    if (busy || selected) return;
    setBusy(true); setError(null);
    try {
      const doc = await getRepository().readIncomingDocument!(id);
      const data = Uint8Array.from(atob(doc.base64), c => c.charCodeAt(0));
      imported.current = false;
      const file = new File([data], doc.name, { type: doc.kind === 'json' ? 'application/json' : 'text/csv' });
      let rulesOnly = false;
      if (doc.kind === 'json') { try { rulesOnly = JSON.parse(await file.text())?.format === 'dagobert_rules'; } catch { /* The chosen import validates the file. */ } }
      setSelected({ ...doc, file, rulesOnly });
    } catch { setError('Die Datei konnte nicht geöffnet werden. Sie bleibt für einen erneuten Versuch erhalten.'); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (!selected || closing) return;
    setClosing(true);
    try {
      await getRepository().acknowledgeIncomingDocument!(selected.id);
      setDocuments(list => list.filter(doc => doc.id !== selected.id));
      setSelected(null);
      if (imported.current) props.onImported();
    } catch { alert('Der Dateieingang konnte nicht bestätigt werden. Bitte erneut schließen. Bereits gespeicherte Daten bleiben erhalten.'); }
    finally { setClosing(false); }
  };
  if (!documents.length && !error) return null;
  return <aside aria-label="Geöffnete Dateien" className="mx-4 mt-4 p-4 rounded-2xl border border-ios-separator dark:border-ios-darkSeparator space-y-2 text-sm">
    <p className="font-semibold">{documents.length ? 'Datei zum Import bereit' : 'Dateieingang'}</p>
    {documents.length > 0 && <p>Gewähltes Profil: {props.profileName}. Prüfe das Zielprofil vor dem Import.</p>}
    {error && <p role="alert" className="text-ios-red">{error}</p>}
    {error && <button type="button" className="min-h-12 text-ios-tint font-semibold" onClick={() => void refreshAction.current?.()}>Dateieingang erneut lesen</button>}
    {documents.map(doc => <button key={doc.id} onClick={() => void open(doc.id)} disabled={busy || !!selected}
      className="block min-h-11 text-ios-tint break-all text-left disabled:opacity-50">{doc.name} prüfen</button>)}
    {selected?.rulesOnly && <RulesTransfer profileId={props.profileId} initialFile={selected.file}
      onClose={() => void close()} onImported={() => { imported.current = true; }} />}
    {selected?.kind === 'json' && !selected.rulesOnly && <BackupImportModal isOpen={!closing} profileId={props.profileId} initialFile={selected.file}
      onClose={() => void close()} onImportComplete={() => { imported.current = true; }} />}
    {selected?.kind === 'csv' && <ImportModal isOpen={!closing} profileId={props.profileId} initialFile={selected.file}
      accounts={props.accounts}
      existingTransactions={props.transactions} bankTemplates={props.bankTemplates} categories={props.categories} rules={props.rules}
      onClose={() => void close()} onImportComplete={() => { imported.current = true; }} />}
  </aside>;
}
