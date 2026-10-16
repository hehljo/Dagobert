# Dagobert 🪙

> **Modernes, lokales Finanz- & Haushaltsbuch mit intelligentem CSV-Import**  
> Konzipiert für den comdirect-Umsatzexport, maximale Flexibilität und ein reduziertes, haptisches iOS-/Google-Design.

---

## 🚀 Highlights & Kern-Features

- **100 % Local-First & DSGVO-sicher:** Alle Finanzdaten, Buchungen und Regeln verbleiben in der lokalen Browser-Sandbox (**IndexedDB**). Optional mit biometrischer App-Sperre (Passkey / PIN). Keine Cloud, kein Tracking, keine Weitergabe an fremde Server.
- **comdirect-Optimierung:**
  - **Automatischer Windows-1252 (CP1252) Decoder:** Schluss mit kaputten Umlauten (`‹bertrag`, `Kartenverf¸gung`). Alle Umlaute werden nativ sauber dargestellt.
  - **Dynamisches Header-Skipping:** comdirect-Metadatenzeilen am Dateianfang werden automatisch erkannt und übersprungen.
  - **Smart-Decomposition:** Der comdirect `Buchungstext` wird automatisch zerlegt in *Gegenpartei/Empfänger* (`Empfänger:`, `Auftraggeber:`), *Verwendungszweck* (`Buchungstext:`) und Bank-Details.
  - **Duplikat-Schutz:** Deterministischer Hash verhindert doppelte Buchungen beim erneuten Import desselben Monats.
- **Intelligente Kategorisierung (Rules Engine):**
  - Mehrstufige Erkennungsregeln (enthält, ist exakt, Regex-Muster).
  - **Smart Learning:** Beim manuellen Ändern einer Kategorie in den Buchungsdetails schlägt Dagobert vor: *„Regel für zukünftige Buchungen merken“*.
  - *„Regeln auf bestehende Buchungen anwenden“*-Button für nachträgliche Re-Kategorisierung.
- **iOS- & Google-Design (Mobile-First):**
  - Ergonomische Touch-Flächen (≥ 48px), sanfte Animationen, Dark Mode (OLED-optimiert).
  - Interaktives **SVG-Kategorien-Donut-Chart** mit Prozentwerten und Klick-Filter.
  - Cashflow-Cockpit (Einnahmen, Ausgaben, Saldo, Sparquote) mit Monats-Navigator.
- **Backup & Portabilität:**
  - 1-Klick-Export aller Daten als JSON-Backup.
  - 1-Klick-Wiederherstellung.
  - Offline-fähig (PWA-tauglich).

---

## 🛠️ Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev

# Tests ausführen (Vitest)
npm test

# Produktions-Build bauen
npm run build
```

---

## 🐳 Deployment auf Synology DiskStation (Portainer / Docker)

Da Dagobert rein statisch im Browser läuft, braucht der Container weder Datenbank noch Backend und verbraucht im Leerlauf **weniger als 10 MB RAM**:

```bash
# Container bauen und starten (Port 5052)
docker compose up -d --build
```

In Portainer als Stack anlegen:

```yaml
version: '3.8'

services:
  dagobert:
    image: ghcr.io/hehljo/dagobert:latest # oder lokal bauen via Dockerfile
    container_name: dagobert
    restart: unless-stopped
    ports:
      - "5052:80"
```

App aufrufen: `http://<diskstation-ip>:5052`

---

## 📄 Lizenz & Urheberschaft

Entwickelt von Johannes Hehl (JFS Systems). Alle Rechte vorbehalten.
