// Einzige Quelle für Name, Kontakt und Rechtslinks. Ohne Umgebungsabhängigkeiten,
// damit Tests und Skripte die Werte importieren statt sie abzuschreiben.
// Rechtstexte liegen im lupfa-Archiv (Portfolio-Repo, src/content/legal.ts, Dokument-ID „dagobert“).
export const BRAND = {
  name: 'Dagobert',
  supportEmail: 'hallo@lupfa.de',
  privacyUrl: 'https://lupfa.de/datenschutz/dagobert/',
  imprintUrl: 'https://lupfa.de/impressum/',
  sourceUrl: 'https://github.com/hehljo/Dagobert',
} as const;
