# Dagobert — Master Roadmap

## Phase 1: MVP & comdirect Import (Abgeschlossen)
- [x] Initiales Projekt-Setup: React 19, TypeScript, Vite, Tailwind CSS.
- [x] comdirect CSV-Parser mit nativem `Windows-1252` Encoding-Support (echte Umlaute).
- [x] Header-Skipping und comdirect `Buchungstext`-Zerlegung (Empfänger vs. Verwendungszweck).
- [x] Intelligente Rules-Engine für automatische Kategorisierung beim Import.
- [x] Smart Learning: Beim manuellen Umkategorisieren automatisch Erkennungsregel vorschlagen.
- [x] Dashboard mit Monats-Navigator, KPI-Karten (Cashflow/Saldo) und interaktivem Donut-Chart.
- [x] Buchungsliste mit Volltextsuche, Datums-Gruppierung und Kategorie-/Typ-Filtern.
- [x] 100 % Local-First: IndexedDB via Dexie.js, JSON-Backup Export & Import.
- [x] Nginx-Container & Docker-Stack für Synology DiskStation / Portainer.

---

## Phase 2: Geplante Erweiterungen (Next Up)

### 1. Ordnerüberwachung für Auto-Import (Watchdog / Hot Folder)
- **Konzept:** Ein überwachter Ordner (z. B. `/volume1/docker/dagobert/import` auf der DiskStation).
- Sobald dort eine neue Bank-CSV (comdirect etc.) per SMB, WebDAV oder FileStation abgelegt wird:
  - Automatisches Einlesen im Hintergrund (ohne manuellen Klick im Web-UI).
  - Prüfung auf Duplikate anhand des Hash-Fingerprints.
  - Automatische Kategorisierung nach den aktiven Regeln.
  - Archivieren der verarbeiteten CSV in einen `archive/`-Unterordner.

### 2. Multi-Bank-Vorlagen & Assistent
- [ ] Vordefinierte Presets für DKB, ING, Sparkasse, N26.
- [ ] Visueller Spalten-Mapping-Assistent direkt im UI für beliebige neue CSV-Formate.

### 3. Erweiterte Finanz-Analysen & Budgets
- [ ] Monatliche Budget-Limits pro Kategorie mit visueller Fortschrittsanzeige (Ampelsystem).
- [ ] Jahresvergleich & Trend-Analysen (Ausgabenentwicklung über 12 Monate).
- [ ] Fixkosten-Erkennung (wiederkehrende Lastschriften / Abos).

### 4. PWA & Mobile Polish
- [ ] Web-App Manifest & Service Worker für vollständige Offline-Nutzung als iOS HomeScreen PWA.
- [ ] Haptisches Feedback & Swipe-Gesten auf Mobilgeräten.
