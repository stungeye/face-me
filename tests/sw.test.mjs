import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
function worker({ offline = false, failInstall = false } = {}) {
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
  vm.runInNewContext(source, {
    self: {
      location: { origin: "https://example.com" },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async () => cache,
      keys: async () => ["face-me-v19", "face-me-v20", "face-me-v21", "other-app"],
      delete: async key => deleted.push(key),
    },
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, "https://example.com/"), options); }
    },
    URL, Response,
    fetch: async (request, options) => {
      requests.push({ request, options });
      if (offline) throw Error("offline");
      return new Response("fresh");
    },
  });
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
  assert.equal(sw.skipped, true);
  const failed = worker({ failInstall: true });
  await assert.rejects(failed.dispatch("install"));
  assert.equal(failed.skipped, false);
});

test("activation removes only obsolete Face Me caches and claims open clients", async () => {
  const sw = worker();
  await sw.dispatch("activate");
  assert.deepEqual(sw.deleted, ["face-me-v19", "face-me-v20"]);
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
