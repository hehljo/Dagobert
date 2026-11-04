import { useEffect, useRef, useState } from 'react';
import type { Account, CategoryRule, ImportPreviewRow, Transaction } from '../types/index.ts';
import { comdirect, appendComdirectTransactions } from '../data/comdirect.ts';
import type { ComdirectAccount, ComdirectReply } from '../data/comdirect.ts';
import { fetchProfileData } from '../lib/api.ts';
import { comdirectAccountFromSource, mapComdirectTransactions, possibleCrossSourceDuplicate, readAllComdirectTransactions } from '../lib/bankImport.ts';
import { autoCategorizePreview } from '../lib/rulesEngine.ts';
import { APP_UNLOCKED_EVENT, isAppLockedError } from '../platform/appAccess.ts';
import { detectPlatform } from '../platform/capabilities.ts';

type Row = ImportPreviewRow & { included: boolean; review: boolean };
interface Props {
  profileId: string; accounts: Account[]; rules: CategoryRule[];
  onClose: () => void; onBack: () => void; onImportComplete: (count: number) => void;
}
const control = 'min-h-12 w-full rounded-xl border border-ios-separator dark:border-ios-darkSeparator bg-white dark:bg-neutral-800 px-3 text-base';
const button = 'min-h-12 rounded-xl px-4 py-3 font-semibold bg-ios-tint text-white disabled:opacity-50';

export function ComdirectImportModal({ profileId, accounts, rules, onClose, onBack, onImportComplete }: Props) {
  const [stage, setStage] = useState<'login' | 'approval' | 'accounts'>('login');
  const [credentials, setCredentials] = useState({ clientId: '', clientSecret: '', username: '', password: '' });
  const [savedAccess, setSavedAccess] = useState<{ saved: boolean; pinStored: boolean; canSave: boolean }>({ saved: false, pinStored: false, canSave: detectPlatform().isNative });
  const [useSaved, setUseSaved] = useState(false);
  const [saveAccess, setSaveAccess] = useState(false);
  const [savePin, setSavePin] = useState(false);
  const [savedAccessError, setSavedAccessError] = useState('');
  const savedInitialized = useRef(false);
  const [challenge, setChallenge] = useState<ComdirectReply['challenge']>();
  const [tan, setTan] = useState('');
  const [bankAccounts, setBankAccounts] = useState<ComdirectAccount[]>([]);
  const [bankId, setBankId] = useState('');
  const [localId, setLocalId] = useState(accounts.find(a => a.id === 'comdirect')?.id || accounts[0]?.id || '');
  const [confirmedTarget, setConfirmedTarget] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [visible, setVisible] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const session = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (session.current) void comdirect('disconnect', profileId, { sessionId: session.current }).catch(() => {});
    };
  }, [profileId]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await comdirect('saved-access', profileId);
        if (active) {
          setSavedAccess({ saved: !!result.saved, pinStored: !!result.pinStored, canSave: !!result.canSave });
          setSavedAccessError('');
          if (!savedInitialized.current) { setUseSaved(!!result.saved); setSavePin(!!result.pinStored); savedInitialized.current = true; }
        }
      } catch (e) { if (active) setSavedAccessError(isAppLockedError(e) ? '' : e instanceof Error ? e.message : 'Gespeicherter Zugang konnte nicht gelesen werden.'); }
    };
    void refresh(); window.addEventListener(APP_UNLOCKED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(APP_UNLOCKED_EVENT, refresh); };
  }, [profileId]);

  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Der Bankabruf ist fehlgeschlagen.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function login() {
    try {
      const result = await comdirect('login', profileId, { ...credentials, useSaved, saveAccess, savePin });
      if (!result.sessionId || !result.challenge) throw new Error('Die Bank hat keine TAN-Freigabe geliefert.');
      session.current = result.sessionId;
      if (!alive.current) { void comdirect('disconnect', profileId, { sessionId: result.sessionId }).catch(() => {}); return; }
      setChallenge(result.challenge); setStage('approval');
    } finally { if (alive.current) setCredentials({ clientId: '', clientSecret: '', username: '', password: '' }); }
  }
  async function confirm() {
    try {
      const result = await comdirect('confirm', profileId, { sessionId: session.current, tan });
      if (!result.accounts) throw new Error('Die Bank hat keine Konten geliefert.');
      if (!alive.current) return;
      const available = result.accounts.filter(a => a.currency === 'EUR');
      setBankAccounts(available); setBankId(available[0]?.accountId || ''); setStage('accounts');
    } catch (e) { setStage('login'); session.current = undefined; throw e; }
    finally { setTan(''); }
  }
  function target() {
    const bank = bankAccounts.find(a => a.accountId === bankId), local = accounts.find(a => a.id === localId);
    if (!bank || !local) throw new Error('Bitte Bankkonto und Zielkonto auswählen.');
    if (!local.iban && !confirmedTarget) throw new Error('Bitte die Zuordnung zum Zielkonto bestätigen.');
    if (accounts.filter(a => a.name === local.name).length !== 1) throw new Error('Die Zielkontobezeichnung ist nicht eindeutig. Bitte zuerst eindeutige Kontonamen vergeben.');
    if (local.iban && local.iban.replace(/\s/g, '').toUpperCase() !== bank.iban.replace(/\s/g, '').toUpperCase()) {
      throw new Error('Die IBAN passt nicht zum Zielkonto. Bitte das richtige Konto auswählen.');
    }
    return { bank, local };
  }
  function preview(values: ImportPreviewRow[], local: Account, existing: Transaction[]): Row[] {
    const exact = new Set(existing.filter(t => t.account === local.name).map(t => t.sourceHash));
    return values.map(row => {
      const duplicate = exact.has(row.sourceHash);
      const review = !duplicate && possibleCrossSourceDuplicate(row, local.name, existing);
      return { ...row, isDuplicate: duplicate, review, included: !duplicate && !review };
    });
  }
  function checkBinding(bank: ComdirectAccount, local: Account, existing: Transaction[]) {
    for (const transaction of existing) {
      const linked = comdirectAccountFromSource(transaction.sourceHash);
      if (linked && ((transaction.account === local.name && linked !== bank.accountId) ||
          (linked === bank.accountId && transaction.account !== local.name))) {
        throw new Error('Bank- und Zielkonto passen nicht zur bisherigen Zuordnung. Bitte dieselbe Zuordnung verwenden.');
      }
    }
  }
  async function read() {
    const { bank, local } = target();
    const before = await fetchProfileData(profileId);
    checkBinding(bank, local, before.transactions);
    setRows(null);
    const all = await readAllComdirectTransactions(first => {
      if (!alive.current) throw new Error('Abruf abgebrochen.');
      return comdirect('transactions', profileId, { sessionId: session.current, accountId: bank.accountId, first });
    });
    const fresh = await fetchProfileData(profileId);
    const mapped = autoCategorizePreview(mapComdirectTransactions(all, bank.accountId), rules);
    if (alive.current) { setRows(preview(mapped, local, fresh.transactions)); setVisible(100); }
  }
  async function commit() {
    const { bank, local } = target();
    const fresh = await fetchProfileData(profileId);
    checkBinding(bank, local, fresh.transactions);
    const selected = (rows || []).filter(row => row.included);
    const checked = preview(selected, local, fresh.transactions);
    if (checked.some((row, i) => row.review && !selected[i].review)) {
      throw new Error('Seit der Vorschau wurden ähnliche Buchungen hinzugefügt. Bitte Umsätze neu abrufen.');
    }
    const now = new Date().toISOString();
    const transactions: Transaction[] = checked.filter(row => !row.isDuplicate).map(row => ({
      date: row.date, valutaDate: row.valutaDate, amount: row.amount, currency: 'EUR',
      payee: row.payee, purpose: row.purpose, rawText: row.rawText, type: row.type,
      category: row.category, account: local.name, sourceHash: row.sourceHash, status: 'booked', importedAt: now,
    }));
    if (!transactions.length) throw new Error('Keine neuen Buchungen ausgewählt.');
    const result = await appendComdirectTransactions(profileId, transactions, selected.filter(row => row.review).map(row => row.sourceHash));
    if (alive.current) { onImportComplete(result.inserted); onClose(); }
  }
  const selected = rows?.filter(row => row.included).length || 0;
  return <div className="glass-overlay fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-label="comdirect direkt abrufen" className="glass-surface w-full max-w-2xl rounded-3xl p-5 max-h-[90dvh] overflow-y-auto space-y-4 text-slate-900 dark:text-white">
      <div className="flex items-center justify-between gap-3"><h2 className="font-bold text-lg">comdirect direkt abrufen</h2>
        <button type="button" className="min-h-12 min-w-12 rounded-xl" onClick={onClose} disabled={busy} aria-label="Schließen">✕</button></div>
      <p className="text-sm text-ios-gray">Kontoumsätze abrufen, prüfen und hinzufügen. Vorhandene Buchungen, Kategorien und Kontostände werden nicht verändert.</p>
      {error && <p role="alert" className="text-sm rounded-xl p-3 bg-ios-red/10 text-ios-red">{error}</p>}
      {savedAccessError && <p role="alert" className="text-sm text-ios-red">{savedAccessError}</p>}
      {stage === 'login' && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(login); }}>
        <p className="text-sm">Du brauchst deinen persönlichen comdirect-API-Zugang. Auf Wunsch wird der Zugang geschützt gespeichert. Die TAN-Freigabe bleibt bei comdirect.</p>
        {savedAccess.saved && <div className="p-3 rounded-xl bg-ios-tint/10 space-y-2 text-sm">
          <label className="flex gap-3 items-center min-h-12"><input type="checkbox" checked={useSaved} onChange={e => setUseSaved(e.target.checked)} disabled={busy} />Gespeicherten Zugang verwenden{savedAccess.pinStored ? ' (einschließlich PIN)' : ' (PIN jeweils eingeben)'}</label>
          <button type="button" className="min-h-12 text-ios-red" disabled={busy} onClick={() => void act(async () => {
            if (!window.confirm('Den gespeicherten comdirect-Zugang entfernen? Deine Buchungen bleiben erhalten.')) return;
            await comdirect('forget-access', profileId); setSavedAccess(old => ({ ...old, saved: false, pinStored: false })); setUseSaved(false); setSavePin(false);
          })}>Gespeicherten Zugang entfernen</button>
        </div>}
        <a className="text-ios-tint underline inline-flex min-h-12 items-center" href="https://www.comdirect.de/cms/kontakt-zugaenge-api.html" target="_blank" rel="noopener noreferrer">API-Zugang bei comdirect verwalten</a>
        {([['clientId', 'Client-ID'], ['clientSecret', 'Client-Secret'], ['username', 'Zugangsnummer'], ['password', 'Onlinebanking-PIN']] as const).filter(([key]) => !useSaved || (key === 'password' && !savedAccess.pinStored)).map(([key, label]) =>
          <label key={key} className="block text-sm font-medium">{label}<input className={control} required maxLength={256} disabled={busy}
            autoComplete="off" autoCapitalize="none" spellCheck={false} type={key === 'clientSecret' || key === 'password' ? 'password' : 'text'}
            value={credentials[key]} onChange={e => setCredentials(old => ({ ...old, [key]: e.target.value }))} /></label>)}
        {savedAccess.canSave ? <div className="space-y-2 text-sm">
          <label className="min-h-12 flex gap-3 items-center"><input type="checkbox" disabled={busy} checked={saveAccess} onChange={e => setSaveAccess(e.target.checked)} />Zugang {useSaved ? 'aktualisieren' : 'speichern'} – {detectPlatform().isNative ? 'im Schlüsselbund dieses Geräts' : 'verschlüsselt auf deinem Server'}</label>
          {saveAccess && <label className="min-h-12 flex gap-3 items-center"><input type="checkbox" disabled={busy} checked={savePin} onChange={e => setSavePin(e.target.checked)} />Onlinebanking-PIN ebenfalls speichern</label>}
        </div> : <p className="text-sm text-ios-gray">Zum Speichern im Web zuerst eine Profil-PIN in den Einstellungen setzen.</p>}
        <p className="text-sm text-ios-gray">Einmal verbinden, dann die TAN-Freigabe abschließen. Wiederholte neue TAN-Anforderungen können den Bankzugang sperren.</p>
        <button className={button} disabled={busy}>{busy ? 'Verbindung wird aufgebaut …' : 'Verbinden und TAN anfordern'}</button>
      </form>}
      {stage === 'approval' && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(confirm); }}>
        <p>{challenge?.typ === 'P_TAN_PUSH' ? 'Bestätige den Zugang in der comdirect photoTAN-App. Kehre danach hierher zurück.' : 'Bitte die TAN für diese Anmeldung eingeben.'}</p>
        {challenge?.typ === 'P_TAN' && challenge.image && /^[A-Za-z0-9+/=\r\n]+$/.test(challenge.image) &&
          <img className="w-64 max-w-full bg-white" src={`data:image/png;base64,${challenge.image}`} alt="photoTAN-Grafik für die Bankfreigabe" />}
        {challenge?.typ !== 'P_TAN_PUSH' && <label className="block">TAN<input className={control} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required value={tan} onChange={e => setTan(e.target.value)} /></label>}
        <button className={button} disabled={busy}>{busy ? 'Freigabe wird geprüft …' : 'Freigabe abgeschlossen'}</button>
      </form>}
      {stage === 'accounts' && <div className="space-y-3">
        {error && <button type="button" className="min-h-12 text-ios-tint underline" disabled={busy} onClick={() => {
          if (session.current) void comdirect('disconnect', profileId, { sessionId: session.current }).catch(() => {});
          session.current = undefined; setRows(null); setStage('login'); setError('');
        }}>Neu verbinden</button>}
        {!bankAccounts.length && <p>Für diesen Zugang wurden keine unterstützten EUR-Konten geliefert. Der CSV-Import bleibt verfügbar.</p>}
        <label className="block text-sm font-medium">Bankkonto<select className={control} disabled={busy} value={bankId} onChange={e => { setBankId(e.target.value); setRows(null); setConfirmedTarget(false); }}>
          {bankAccounts.map(a => <option key={a.accountId} value={a.accountId}>{a.label} · {a.iban || 'ohne IBAN'}</option>)}</select></label>
        <label className="block text-sm font-medium">In dieses Dagobert-Konto importieren<select className={control} disabled={busy} value={localId} onChange={e => { setLocalId(e.target.value); setRows(null); setConfirmedTarget(false); }}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.iban ? ` · ${a.iban}` : ''}</option>)}</select></label>
        {!accounts.find(a => a.id === localId)?.iban && <label className="min-h-12 flex items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={confirmedTarget} onChange={e => setConfirmedTarget(e.target.checked)} />Dieses Bankkonto gehört zum gewählten Dagobert-Konto.</label>}
        <button type="button" className={button} disabled={busy || !bankId || !localId} onClick={() => void act(read)}>{busy ? 'Bitte warten …' : 'Umsätze zur Vorschau abrufen'}</button>
        {rows && <>
          <button type="button" className={button} disabled={busy || !selected} onClick={() => void act(commit)}>{selected} Buchungen hinzufügen</button>
          <p className="text-sm">{rows.length} gebuchte Umsätze, {rows.filter(r => r.isDuplicate).length} bereits vorhanden. {rows.filter(r => r.review).length} Buchungen liegen im bisher importierten Zeitraum und sind zunächst abgewählt. Diese nur auswählen, wenn es wirklich zusätzliche Buchungen sind.</p>
          <div role="region" aria-label="Geladene Umsätze" className="max-h-72 overflow-y-auto divide-y divide-ios-separator">
            {rows.slice(0, visible).map((row, index) => <label key={row.sourceHash} className={`min-h-12 flex items-start gap-3 py-3 text-sm ${row.isDuplicate ? 'opacity-50' : ''}`}>
              <span className="min-h-12 min-w-12 flex justify-center items-center"><input type="checkbox" checked={row.included} disabled={busy || row.isDuplicate}
                onChange={e => setRows(old => old?.map((r, i) => i === index ? { ...r, included: e.target.checked } : r) || null)} /></span>
              <span className="min-w-0 flex-1 break-words"><strong>{row.payee}</strong><br />{row.date} · {row.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}<br />{row.purpose}
                {row.review && <span className="block text-amber-600 dark:text-amber-400">Möglicherweise bereits per CSV vorhanden</span>}{row.isDuplicate && <span className="block">Bereits importiert</span>}</span>
            </label>)}
          </div>
          {visible < rows.length && <button type="button" className="min-h-12 underline" onClick={() => setVisible(n => n + 100)}>Weitere Buchungen anzeigen</button>}
        </>}
      </div>}
      <button type="button" onClick={onBack} disabled={busy} className="min-h-12 text-ios-tint font-semibold">Zurück zum CSV-Import</button>
    </div>
  </div>;
}
