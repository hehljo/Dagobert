# Dagobert 🪙

<p align="center">
  <img src="docs/IconDagobertV2.png" width="120" height="120" alt="Dagobert Icon" style="border-radius: 28px;">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.9.0-blue.svg?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Node-22%2B-green.svg?style=flat-square&logo=node.js" alt="Node">
  <img src="https://img.shields.io/badge/React-19-blue.svg?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue.svg?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Tests-80%20passed-success.svg?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED.svg?style=flat-square&logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/Privacy-100%25%20Local--First-emerald.svg?style=flat-square" alt="Privacy">
  <a href="https://buymeacoffee.com/pommesbude" target="_blank"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support%20Development-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=black" alt="Buy Me A Coffee"></a>
</p>

<p align="center">
  <b>Schlankes, selbstgehostetes Finanz- & Haushaltsbuch mit intelligentem CSV-Import, Multi-Profil-Verwaltung und kompromissloser Datensicherheit.</b><br>
  <i>Keine Cloud. Kein Abo. Kein Ressourcen-Fresser. Entwickelt für Synology DiskStation, Raspberry Pi oder jeden Docker-Host.</i>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/pommesbude" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="42">
  </a>
</p>

---

## 🎯 Warum Dagobert?

Bestehende Self-Hosted-Finanztools (wie *Firefly III* oder *Actual Budget*) sind entweder ressourcenhungrige Container-Monster mit mehreren Hilfsdiensten, erfordern externe Datenbank-Cluster oder scheitern an den typischen Eigenheiten deutscher Bank-Exporte (Umlaut-Salat, comdirect Header-Metadaten, unstrukturierte Buchungstexte).

**Dagobert geht den minimalistischen Weg:**
- **Ein einziger schlanker Docker-Container** (unter 25 MB RAM im Leerlauf).
- **Zentrale SQLite-Datenbank** im Container gemountet – keine Postgres-, MySQL- oder Redis-Container nötig.
- **Spezialisiert auf deutsche Bankauszüge** (aktuell mit nativem Spezial-Parser für **comdirect**, weitere Banken wie ING, DKB oder Sparkasse auf Anfrage problemlos erweiterbar).
- **Mobile-First & PWA-tauglich:** Am iPhone/Android im Browser mit nativen Gesten, Bottom-Navigation und OLED Dark Mode bedienbar.

---

## 🚀 Kern-Features

### 🔒 Kompromisslose Privatsphäre & Sicherheit
- **100 % Local-First & DSGVO-konform:** Deine Bankumsätze und Salden verlassen niemals dein eigenes Heimnetzwerk. Keine Drittanbieter, kein Tracking.
- **Globale Server-PIN:** Schützt Profile serverseitig in SQLite mit Brute-Force-Sperre (Rate-Limiting) und 12h-Sitzung. Bevor eine PIN nicht verifiziert ist, liefert die API keinen einzigen Datensatz aus.
- **Biometrische App-Sperre:** Unterstützt zusätzlich Passkeys (Face ID / Touch ID) sowie lokale Geräte-PINs.

### 💳 Smarter comdirect CSV-Import
- **Automatischer CP1252-Decoder:** Kein Umlaut-Chaos mehr (`Kartenverf¸gung` ➔ `Kartenverfügung`).
- **Dynamisches Header-Skipping:** Erkennt die comdirect-Metadatenzeilen am Dateianfang automatisch und startet direkt bei den Buchungen.
- **Intelligente Textzerlegung:** Trennt automatisiert Auftraggeber/Empfänger, Vorgangsart und Verwendungszweck aus dem unstrukturierten Buchungstext.
- **Stichtags- & Saldoprüfung:** Erkennt den echten Konto-Saldo laut Auszug und gleicht historische Buchungen lückenlos ab.
- **Duplikat-Schutz:** Deterministische Prüfsummen verhindern doppelte Buchungen bei sich überschneidenden Monats-Exporten.
- *Weitere Banken:* Die Parser-Architektur ist modular ausgelegt – weitere deutsche und europäische Institute können auf Wunsch ergänzt werden.

### 🧠 Intelligente Erkennungsregeln (Rules Engine)
- **Granulare Kriterien:** Filtere gezielt nach *nur Empfänger*, *Verwendungszweck*, *Buchungstext*, *Betrag* oder *Buchungsart* (enthält, ist exakt, Regex).
- **One-Click Rule Learning:** Beim Kategorisieren einer Buchung schlägt Dagobert direkt vor, eine Regel für die Zukunft anzulegen.
- **Rückwirkendes Anwenden:** Neue oder bearbeitete Regeln können mit einem Klick rückwirkend auf alle passenden historischen Buchungen angewendet werden.
- **Standard-Regelwerk:** Enthält vordefinierte Regeln für gängige Händler, Supermärkte, Tankstellen und Abos.

### 👥 Multi-Profil & UX
- **Echte Profiltrennung:** Verwalte private Finanzen, Geschäftskonto oder Familienbudget sauber getrennt mit individuellen Farben, Icons und PIN-Schutz.
- **Inline-Kategorien:** Lege neue Kategorien direkt beim Kategorisieren einer Buchung an, ohne das Modal zu verlassen.
- **Visuelles Dashboard:** Cashflow-Cockpit mit Einnahmen, Ausgaben, Sparquote und interaktivem SVG-Donut-Diagramm.

---

## 🐳 Schnelle Installation (Docker / Synology DiskStation)

Dagobert ist als leichtgewichtiger All-in-One-Container konzipiert:

### Docker Compose (Empfohlen)
```yaml
version: "3.8"

services:
  dagobert:
    build: .
    container_name: dagobert
    restart: unless-stopped
    ports:
      - "5052:5052"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=5052
```

Container starten:
```bash
docker compose up -d --build
```

Nach dem Start erreichbar unter: `http://<deine-server-ip>:5052`

---

## 🛠️ Lokale Entwicklung & Tests

```bash
# Repository klonen
git clone https://github.com/hehljo/Dagobert.git
cd Dagobert

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev

# Tests ausführen (Vitest & Node Test-Runner)
npm test

# Vollständige UI- & Browser-Workflows via Playwright prüfen
npm run test:ui

# Produktions-Build erstellen
npm run build
```

---

## ☕ Support & Kaffee

Dagobert wird unabhängig als Open-Source-Projekt für das eigene Homelab entwickelt. Wenn dir das Tool gefällt oder dir bei deinen Finanzen Klicks und Nerven spart, freue ich mich über einen Kaffee:

<p align="center">
  <a href="https://buymeacoffee.com/pommesbude" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="46">
  </a>
</p>

---

## 🏷️ GitHub Topics & Tags
`personal-finance` · `self-hosted` · `fintech` · `budgeting` · `comdirect` · `local-first` · `docker` · `sqlite` · `react` · `typescript` · `synology` · `homelab` · `csv-parser`
