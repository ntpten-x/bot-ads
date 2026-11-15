import { chromium, expect } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(tmpdir(), "collector-ui-"));
await cp("dist/extension", path.join(temp, "extension"), { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(temp, "extension/manifest.json"), "utf8"),
);
manifest.host_permissions.push(...manifest.optional_host_permissions);
delete manifest.optional_host_permissions;
await writeFile(
  path.join(temp, "extension/manifest.json"),
  JSON.stringify(manifest),
);
const context = await chromium.launchPersistentContext(
  path.join(temp, "profile"),
  {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${path.join(temp, "extension")}`,
      `--load-extension=${path.join(temp, "extension")}`,
    ],
  },
);
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const ext = new URL(worker.url()).host;
  const unexpected: string[] = [];
  await context.route("https://**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      !["adsmanager.facebook.com", "business.facebook.com"].includes(
        url.hostname,
      )
    ) {
      unexpected.push(url.hostname);
      return route.abort();
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="font:16px sans-serif"><h1>Create campaign</h1><p>Account 123456789</p>
 <label>Campaign name <input id="name" aria-label="Campaign name"></label><label>Budget <input id="budget" type="number" value="100"></label>
 <label>Placement <select id="placement"><option value="auto">Automatic</option><option value="feed">Feed</option></select></label>
 <button id="objective" role="combobox" aria-label="Objective" onclick="document.getElementById('options').hidden=false">Choose objective</button><div id="options" hidden><button role="option" onclick="document.getElementById('objective').textContent='Traffic';this.parentElement.hidden=true">Traffic</button></div>
 <label>Image <input id="image" type="file" accept="image/png"></label><input type="password" aria-label="Password" value="not-for-bot"><input aria-label="API token" value="secret-not-for-bot">
 <button id="next" onclick="document.getElementById('step').textContent='Review'"><span>Next</span></button><button id="publish" onclick="document.getElementById('step').textContent='Published'">Publish</button><button id="save">Save draft</button>
 <p id="step">Editing</p><p id="events"></p><script>document.getElementById('name').addEventListener('input',e=>document.getElementById('events').textContent=e.target.value);</script></body></html>`,
    });
  });
  const meta = await context.newPage();
  await meta.goto(
    "https://adsmanager.facebook.com/adsmanager/creation?act=123456789",
  );
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${ext}/popup.html`);
  const send = (payload: Record<string, unknown>) =>
    popup.evaluate((p) => chrome.runtime.sendMessage(p), payload);
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) =>
      t.url?.startsWith("https://adsmanager.facebook.com/"),
    )!.id!;
  });
  await worker.evaluate(
    (token) => chrome.storage.session.set({ token }),
    process.env.API_TOKEN!,
  );
  expect(
    (await send({ command: "bridgeEnable", tabId, account: "123456789" })).ok,
  ).toBe(true);
  const observe = async () => {
    const r = await send({ command: "ui.action", action: { type: "inspect" } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.ui.snapshot;
  };
  let snapshot = await observe();
  const node = (label: string) => {
    const target = snapshot.controls.find((c: any) => c.label === label);
    expect(target, `Control missing: ${label}`).toBeTruthy();
    return { snapshot_id: snapshot.snapshot_id, target: target.id };
  };
  expect(
    snapshot.controls.some((c: any) =>
      ["Password", "API token"].includes(c.label),
    ),
  ).toBe(false);
  const denied = await send({
    command: "ui.action",
    action: { type: "fill", ...node("Campaign name"), value: "New campaign" },
  });
  expect(denied.ok).toBe(false);
  expect(denied.error).toContain("Enable a UI control session");
  expect((await send({ command: "uiSession", action: "enable" })).ok).toBe(
    true,
  );
  const old = node("Campaign name");
  let r = await send({
    command: "ui.action",
    action: { type: "fill", ...old, value: "New campaign" },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  await expect(meta.locator("#name")).toHaveValue("New campaign");
  await expect(meta.locator("#events")).toHaveText("New campaign");
  const stale = await send({
    command: "ui.action",
    action: { type: "fill", ...old, value: "Wrong" },
  });
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Stale");
  r = await send({
    command: "ui.action",
    action: { type: "select", ...node("Placement"), value: "feed" },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  await expect(meta.locator("#placement")).toHaveValue("feed");
  r = await send({
    command: "ui.action",
    action: { type: "click", ...node("Objective") },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  r = await send({
    command: "ui.action",
    action: { type: "click", ...node("Traffic") },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  await expect(meta.locator("#objective")).toHaveText("Traffic");
  r = await send({
    command: "ui.action",
    action: {
      type: "upload",
      ...node("Image"),
      filename: "sample.png",
      mime_type: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
    },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  expect(
    await meta
      .locator("#image")
      .evaluate((el: HTMLInputElement) => el.files?.[0]?.name),
  ).toBe("sample.png");
  r = await send({
    command: "ui.action",
    action: { type: "click", ...node("Next") },
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  await expect(meta.locator("#step")).toHaveText("Review");
  const publish = {
    command: "ui.action",
    action: { type: "click", ...node("Publish") },
  };
  r = await send(publish);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.ui.outcome).toBe("awaiting_local_review");
  const approvalId = r.ui.approval_id;
  await expect(meta.locator("#step")).toHaveText("Review");
  expect(
    (
      await send({
        command: "uiSession",
        action: "approve",
        approval_id: approvalId,
      })
    ).ok,
  ).toBe(true);
  r = await send({ ...publish, approval_id: approvalId });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  snapshot = r.ui.snapshot;
  await expect(meta.locator("#step")).toHaveText("Published");
  // A consumed approval cannot be reused on another target or a fresh observation.
  const replay = await send({
    command: "ui.action",
    action: { type: "click", ...node("Publish") },
    approval_id: approvalId,
  });
  expect(replay.ok).toBe(false);
  await send({ command: "uiSession", action: "disable" });
  const blocked = await send({
    command: "ui.action",
    action: { type: "fill", ...node("Budget"), value: "200" },
  });
  expect(blocked.ok).toBe(false);
  const external = await send({
    command: "ui.navigate",
    url: "https://graph.facebook.com/v27.0/123",
  });
  expect(external.ok).toBe(false);
  await meta.goto("https://business.facebook.com/latest/home?business_id=42");
  snapshot = await observe();
  expect(snapshot.account_verified).toBe(false);
  expect((await send({ command: "uiSession", action: "enable" })).ok).toBe(
    false,
  );
  const bridge = (await send({ command: "bridgeStatus" })).bridge;
  const headers = {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(
    `http://127.0.0.1:4318/devices/${bridge.device}/commands`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        command: "ui.action",
        action: { type: "inspect" },
      }),
    },
  );
  expect(response.status).toBe(201);
  const queued = await response.json();
  await worker.evaluate(() =>
    chrome.alarms.create("bridge", { when: Date.now() + 100 }),
  );
  await expect
    .poll(
      async () => {
        const r = await (
          await fetch(
            `http://127.0.0.1:4318/devices/${bridge.device}/commands/${queued.id}`,
            { headers },
          )
        ).json();
        return r.status;
      },
      { timeout: 15000 },
    )
    .toBe("done");
  const receipt = await (
    await fetch(
      `http://127.0.0.1:4318/devices/${bridge.device}/commands/${queued.id}`,
      { headers },
    )
  ).json();
  expect(receipt.result.ui.snapshot.account_verified).toBe(false);
  expect(receipt.result.ui.snapshot.controls.length).toBeGreaterThan(0);
  await send({ command: "bridgeDisable" });
  expect(unexpected).toEqual([]);
  console.log(
    "UI browser integration passed: isolated DOM inspect, guarded fill, native/custom selects, upload, stale handles, one-time publish review, read-only Suite page, no Meta API requests",
  );
} finally {
  await context.close();
  await rm(temp, { recursive: true, force: true });
}
