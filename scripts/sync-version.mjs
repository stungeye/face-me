import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Checked-in output keeps production deployment build-free. Local JS/CSS URLs
// get distinct cache keys per release; the worker registration stays stable.
export async function syncVersion(root, { check = false } = {}) {
  const context = vm.createContext({});
  vm.runInContext(await readFile(resolve(root, "version.js"), "utf8"), context);
  const version = context.FACE_ME_VERSION;
  if (typeof version !== "string" || !/^[0-9]+(?:\.[0-9]+)*(?:-[a-zA-Z0-9.-]+)?$/.test(version)) {
    throw new Error("version.js must define a valid release version");
  }
  const files = ["index.html", ...(await readdir(root)).filter(name => name.endsWith(".js") && name !== "version.js")];
  const changes = [];
  for (const file of files) {
    const path = resolve(root, file);
    const original = await readFile(path, "utf8");
    const updated = original.replace(/(["'])(\.\/[^"'?\s]+\.(?:js|css))(?:\?[^"'\s]*)?\1/g,
      (match, quote, asset) => asset === "./sw.js" ? match : `${quote}${asset}?v=${version}${quote}`);
    if (original !== updated) changes.push({ path, updated, file });
  }
  if (check && changes.length) {
    throw new Error(`Stale release URLs in ${changes.map(change => change.file).join(", ")}. Run npm run version:sync.`);
  }
  for (const { path, updated } of changes) await writeFile(path, updated);
  return { version, changed: changes.map(change => change.file) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await syncVersion(resolve(dirname(fileURLToPath(import.meta.url)), ".."), { check: process.argv.includes("--check") });
    console.log(`Release ${result.version}: ${result.changed.length ? `updated ${result.changed.join(", ")}` : "asset URLs are synchronized"}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
