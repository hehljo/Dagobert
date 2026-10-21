import { chromium } from "playwright";
import { startTestServer, request } from "/root/Dagobert/tests/helpers/server.mjs";
import { execSync } from "child_process";
import fs from "fs";

async function main() {
  const server = await startTestServer();
  const api = (route, method, body) => request(server.url, route, method, body);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const ym = `${year}-${month}`;

  const sampleTxs = [
    { date: `${ym}-01`, amount: 3450.00, payee: "Arbeitgeber GmbH", purpose: "Gehalt", rawText: "Gehalt", type: "Überweisung", category: "gehalt", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-02`, amount: -850.00, payee: "Hausverwaltung Becker", purpose: "Miete", rawText: "Miete", type: "Dauerauftrag", category: "wohnen", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-04`, amount: -74.20, payee: "REWE Supermarkt", purpose: "Wocheneinkauf", rawText: "REWE", type: "Kartenverfügung", category: "lebensmittel", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-06`, amount: -82.50, payee: "ARAL Tankstelle", purpose: "Super E10 getankt", rawText: "ARAL", type: "Kartenverfügung", category: "mobilitaet", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-08`, amount: -17.99, payee: "Netflix", purpose: "Monatsbeitrag", rawText: "Netflix", type: "Lastschrift", category: "abos", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-11`, amount: -48.00, payee: "Pizzeria Da Salvatore", purpose: "Abendessen", rawText: "Pizzeria", type: "Kartenverfügung", category: "freizeit", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-13`, amount: -350.00, payee: "Trade Republic", purpose: "ETF Sparplan", rawText: "Wertpapiere", type: "Überweisung", category: "investieren", account: "comdirect Girokonto", status: "booked" },
    { date: `${ym}-15`, amount: -62.30, payee: "dm Drogeriemarkt", purpose: "Drogerieartikel", rawText: "dm", type: "Kartenverfügung", category: "gesundheit", account: "comdirect Girokonto", status: "booked" }
  ];

  await api("/api/transactions/batch", "POST", { profileId: "privat", transactions: sampleTxs });
  await api("/api/accounts/comdirect", "PUT", { profileId: "privat", initialBalance: 1250, checkpointBalance: 3215.01, checkpointDate: `${ym}-15` });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("dagobert_theme", "dark");
  });
  const page = await context.newPage();
  await page.goto(server.url);
  await page.waitForSelector(".glass-kpi");
  await page.waitForTimeout(1200);

  const shotPath = "/root/Dagobert/docs/screenshot-dashboard.png";
  await page.screenshot({ path: shotPath });
  await browser.close();
  await server.stop();

  execSync(`pngquant --quality 80-95 --force --output ${shotPath} ${shotPath}`);
  console.log("Screenshot size:", fs.statSync(shotPath).size, "bytes");
}

main().catch(console.error);
