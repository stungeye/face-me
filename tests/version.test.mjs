import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { syncVersion } from "../scripts/sync-version.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("single-source release sync updates static URLs and rejects stale output without writing", async t => {
  const fixture = await mkdtemp(join(tmpdir(), "face-me-version-"));
  t.after(() => {
    assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
    assert.ok(basename(fixture).startsWith("face-me-version-"));
    return rm(fixture, { recursive: true, force: true });
  });
  const files = ["index.html", ...(await readdir(root)).filter(name => name.endsWith(".js"))];
  await Promise.all(files.map(file => copyFile(join(root, file), join(fixture, file))));
  await syncVersion(fixture, { check: true });
  await writeFile(join(fixture, "version.js"), 'globalThis.FACE_ME_VERSION = "99.42";\n');
  const before = await readFile(join(fixture, "app.js"), "utf8");
  await assert.rejects(syncVersion(fixture, { check: true }), /Stale release URLs/);
  assert.equal(await readFile(join(fixture, "app.js"), "utf8"), before);
  await syncVersion(fixture);
  await syncVersion(fixture, { check: true });

  const html = await readFile(join(fixture, "index.html"), "utf8");
  assert.ok(html.includes('./app.js?v=99.42'));
  assert.ok(html.includes('./styles.css?v=99.42'));
  const app = await readFile(join(fixture, "app.js"), "utf8");
  for (const asset of ["core", "lifecycle", "famous-locations", "version"]) {
    assert.ok(app.includes(`./${asset}.js?v=99.42`));
  }
  const worker = await readFile(join(fixture, "sw.js"), "utf8");
  const versionSource = await readFile(join(fixture, "version.js"), "utf8");
  const context = vm.createContext({
    importScripts: url => {
      assert.equal(url, "./version.js?v=99.42");
      vm.runInContext(versionSource, context);
    },
    self: { addEventListener() {} },
  });
  const assets = vm.runInContext(`${worker}\nASSETS`, context);
  for (const asset of ["app.js", "styles.css", "core.js", "lifecycle.js", "famous-locations.js", "version.js"]) {
    assert.ok(assets.includes(`./${asset}?v=99.42`), `precache matches ${asset}`);
  }
  await writeFile(join(fixture, "sw.js"), worker.replace('./core.js?v=99.42', './core.js?v=stale'));
  await assert.rejects(syncVersion(fixture, { check: true }), /sw.js/);
  await syncVersion(fixture);
  assert.equal(await readFile(join(fixture, "sw.js"), "utf8"), worker);
});
