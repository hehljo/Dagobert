import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const UPSTREAM = "https://github.com/ionic-team/capacitor-swift-pm.git";
export const FORK = "https://github.com/hehljo/capacitor-swift-pm.git";
const manifest = "ios/App/CapApp-SPM/Package.swift";
const lock =
  "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved";

// Capacitor regenerates the manifest during sync/update; npm ci restores the
// plugin manifests. Keep every dependency on the same SwiftPM repository URL.
export async function syncSpmFork(root = process.cwd(), check = false) {
  const main = resolve(root, manifest);
  const source = await readFile(main, "utf8");
  const files = [main];
  for (const [, path] of source.matchAll(
    /\.package\([^)]*\bpath:\s*"([^"\n]+)"/g,
  )) {
    const file = resolve(dirname(main), path, "Package.swift");
    assert(
      !relative(resolve(root), file).startsWith(".."),
      "SPM path escapes repository",
    );
    await access(file).catch(() => {
      throw new Error(
        `Local Swift package missing: ${relative(root, file)}. Run npm ci before opening Xcode.`,
      );
    });
    files.push(file);
  }
  if (check) {
    await access(resolve(root, lock));
    files.push(resolve(root, lock));
  } else {
    try {
      await access(resolve(root, lock));
      files.push(resolve(root, lock));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const file of new Set(files)) {
    const actual = await readFile(file, "utf8");
    const expected = actual.replaceAll(UPSTREAM, FORK);
    if (check)
      assert.equal(
        actual,
        expected,
        `SwiftPM fork drift: ${relative(root, file)}`,
      );
    else if (actual !== expected) await writeFile(file, expected);
  }
  assert(
    (await readFile(main, "utf8")).includes(FORK),
    "CapApp-SPM has no Capacitor fork dependency",
  );
  return files.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const count = await syncSpmFork(
    process.cwd(),
    process.argv.includes("--check"),
  );
  process.stdout.write(`SPM_FORK_RESULT manifests=${count} failed=0\n`);
}
