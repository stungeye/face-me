import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const versionSource = await readFile(new URL("../version.js", import.meta.url), "utf8");
const versionContext = vm.createContext({});
vm.runInContext(versionSource, versionContext);
const currentVersion = versionContext.FACE_ME_VERSION;
const currentCache = `face-me-v${currentVersion}`;
const obsoleteCaches = ["face-me-v19", "face-me-v20", "face-me-v21", "face-me-v22"];
function worker({ offline = false, failInstall = false, failUrls = [] } = {}) {
  const handlers = {}, deleted = [], requests = [], stored = new Map();
  let skipped = false, claimed = false;
  const cache = {
    addAll: async assets => {
      requests.push(...assets);
      if (failInstall) throw Error("offline");
    },
    put: async (request, response) => stored.set(request.url, response),
    match: async request => stored.get(request.url || request),
  };
  const context = vm.createContext({
    importScripts: url => {
      assert.equal(url, `./version.js?v=${currentVersion}`);
      vm.runInContext(versionSource, context);
    },
    self: {
      location: { origin: "https://example.com" },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async name => { assert.equal(name, currentCache); return cache; },
      keys: async () => [...obsoleteCaches, currentCache, "other-app"],
      delete: async key => deleted.push(key),
    },
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, "https://example.com/"), options); }
    },
    URL, Response,
    fetch: async (request, options) => {
      requests.push({ request, options });
      if (offline || failUrls.includes(request.url)) throw Error("offline");
      return new Response("fresh");
    },
  });
  vm.runInContext(source, context);
  return {
    deleted, requests, stored,
    get skipped() { return skipped; },
    get claimed() { return claimed; },
    async dispatch(name, request) {
      const pending = [];
      let response;
      handlers[name]({ request, waitUntil: promise => pending.push(promise), respondWith: promise => { response = promise; } });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test("installation bypasses HTTP cache and activates only after assets succeed", async () => {
  const sw = worker();
  await sw.dispatch("install");
  assert.ok(sw.requests.every(request => request.cache === "reload"));
  assert.ok(sw.requests.some(request => request.url === `https://example.com/version.js?v=${currentVersion}`));
  assert.equal(sw.skipped, true);
  const failed = worker({ failInstall: true });
  await assert.rejects(failed.dispatch("install"));
  assert.equal(failed.skipped, false);
});

test("partial release fetch failures never reuse a previous release asset key", async () => {
  const newCore = `https://example.com/core.js?v=${currentVersion}`;
  const sw = worker({ failUrls: [newCore] });
  // Even if an older tab has populated the active cache, exact keys isolate it.
  sw.stored.set("https://example.com/core.js?v=1.9", new Response("old core"));
  const app = await sw.dispatch("fetch", new Request(`https://example.com/app.js?v=${currentVersion}`));
  assert.equal(await app.text(), "fresh");
  assert.equal((await sw.dispatch("fetch", new Request(newCore))).type, "error");
  sw.stored.set(newCore, new Response("current core"));
  assert.equal(await (await sw.dispatch("fetch", new Request(newCore))).text(), "current core");
});

test("activation removes only obsolete Face Me caches and claims open clients", async () => {
  const sw = worker();
  await sw.dispatch("activate");
  assert.deepEqual(sw.deleted, obsoleteCaches);
  assert.equal(sw.claimed, true);
});

test("online requests revalidate and refresh the offline copy", async () => {
  const sw = worker();
  const request = new Request("https://example.com/app.js?v=20");
  assert.equal(await (await sw.dispatch("fetch", request)).text(), "fresh");
  assert.equal(sw.requests[0].options.cache, "no-cache");
  assert.equal(await sw.stored.get(request.url).text(), "fresh");
});

test("offline shared URLs get the app shell; missing scripts never get HTML", async () => {
  const sw = worker({ offline: true });
  sw.stored.set("./index.html", new Response("shell"));
  const page = await sw.dispatch("fetch", { method: "GET", url: "https://example.com/?lat=1&lon=2", mode: "navigate" });
  assert.equal(await page.text(), "shell");
  const script = await sw.dispatch("fetch", new Request("https://example.com/missing.js"));
  assert.equal(script.type, "error");
});
