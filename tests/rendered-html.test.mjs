import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Factory X game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Factory X — Automation Prototype<\/title>/i);
  assert.match(html, />A-17</);
  assert.match(html, />PROJECT</);
  assert.match(html, />기초 정착 패키지</);
  assert.match(html, /aria-label="건설 도구"/);
  assert.match(html, /aria-label="공장 전체 생산 계보 열기"/);
  assert.match(html, /aria-label="전체 건설 카탈로그 열기"/);
  assert.match(html, />생산 계보</);
  assert.match(html, />건설 카탈로그</);
  assert.match(html, /<kbd>G<\/kbd>/);
  assert.doesNotMatch(html, /<kbd>TAB<\/kbd>/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});
