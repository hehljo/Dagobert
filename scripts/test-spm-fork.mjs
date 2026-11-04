import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { syncSpmFork, UPSTREAM, FORK } from "./spm-fork.mjs";

const root = await mkdtemp(join(tmpdir(), "dagobert-spm-"));
const app = "ios/App/CapApp-SPM/Package.swift";
const plugin = "node_modules/@capacitor/share/Package.swift";
const lock =
  "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved";
const write = async (path, source) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), source);
};
try {
  const main = `.package(url: "${FORK}", exact: "8.6.0"),\n.package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share")`;
  await write(app, main);
  await write(plugin, `.package(url: "${FORK}", from: "8.0.0")`);
  await write(lock, JSON.stringify({ pins: [{ location: FORK }] }));
  assert.equal(await syncSpmFork(root, true), 3); // Gesund-Lauf (Baseline)

  // Sabotage 1: Drift zu Upstream in jeder Datei
  for (const path of [app, plugin, lock]) {
    const original = await readFile(join(root, path), "utf8");
    await write(path, original.replaceAll(FORK, UPSTREAM));
    await assert.rejects(syncSpmFork(root, true), /SwiftPM fork drift/);
    await syncSpmFork(root);
    assert.equal(await readFile(join(root, path), "utf8"), original);
    await syncSpmFork(root, true);
  }

  // Sabotage 2: Fehlendes node_modules Plugin
  const source = await readFile(join(root, plugin), "utf8");
  await rename(join(root, plugin), join(root, 'plugin-held.swift'));
  await assert.rejects(syncSpmFork(root, true), /Run npm ci/);
  await write(plugin, source);
  await syncSpmFork(root, true);

  // Sabotage 3: Fehlende Package.resolved
  await rename(join(root, lock), join(root, 'lock-held.json'));
  await assert.rejects(syncSpmFork(root, true), /ENOENT/);

  console.log("SPM_GATE_RESULT healthy=1 mutations=5 detected=5 failed=0");
} finally {
  if (process.env.DAGOBERT_KEEP_TEST_DATA !== '1') await rm(root, { recursive: true, force: true });
}
