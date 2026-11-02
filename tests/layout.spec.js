// Layout tests for the kiosk board. Run from this folder: npm ci && npx playwright test
const { test, expect } = require("@playwright/test");
const { SCENARIOS, ADVISORY, json, openBoard, layoutProblems, columnSummary } = require("./helpers");

// The Fire HD 8 first; then other common landscape and portrait screens.
const VIEWPORTS = [
  { name: "fire-hd8", width: 960, height: 600, deviceScaleFactor: 4 / 3 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "ipad-portrait", width: 768, height: 1024 },
  { name: "phone-portrait", width: 390, height: 844 }
];

// Nothing clipped, overlapping or cut off, for every screen x data combination,
// with and without container-unit support.
for (const vp of VIEWPORTS) {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const mode of ["css", "fallback"]) {
      test(`no layout problems: ${vp.name} / ${scenario} / ${mode}`, async ({ browser }, testInfo) => {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1 });
        await openBoard(page, { etd: SCENARIOS[scenario], bsa: scenario === "delays" ? ADVISORY : undefined, query: mode === "fallback" ? "?nocq" : "" });
        if (vp.name === "fire-hd8" && mode === "css") {
          await testInfo.attach(`${vp.name}-${scenario}`, { body: await page.screenshot(), contentType: "image/png" });
        }
        expect(await layoutProblems(page)).toEqual([]);
        await page.close();
      });
    }
  }
}

test("each platform is sized for 3 rows, or 4 when a column has 4+ trains", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page, { etd: SCENARIOS.normal });
  let cols = await columnSummary(page);
  expect(cols["col-sf"].rows).toBe(3);
  const threeRowFont = cols["col-sf"].fontPx;

  await openBoard(page, { etd: SCENARIOS.busy });
  cols = await columnSummary(page);
  expect(cols["col-bery"].rows).toBe(4);        // 5 Berryessa trains -> next 4
  expect(cols["col-sf"].rows).toBe(4);          // Daly City + SF Airport
  expect(cols["col-rich"].rows).toBe(3);
  expect(cols["col-sf"].fontPx).toBeLessThan(threeRowFont);
});

test("container units and the script fallback give about the same sizes", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await openBoard(page, { etd: SCENARIOS.busy });
  const css = await columnSummary(page);
  await openBoard(page, { etd: SCENARIOS.busy, query: "?nocq" });
  const fallback = await columnSummary(page);
  for (const id of Object.keys(css)) {
    if (css[id].fontPx) expect(Math.abs(css[id].fontPx - fallback[id].fontPx)).toBeLessThanOrEqual(2);
  }
});

test("delays: 2 min or less ignored; 3-4 yellow; 5+ red; ticker lists them worst first", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page, { etd: SCENARIOS.delays });
  const marks = await page.$$eval(".mins.late", els => els.map(m => ({
    text: m.textContent,
    badge: m.parentElement.querySelector(".late-badge").textContent,
    severity: m.classList.contains("major") ? "major" : "minor"
  })));
  expect(marks).toEqual(expect.arrayContaining([
    { text: "Now", badge: "10", severity: "major" },
    { text: "36", badge: "3", severity: "minor" },
    { text: "24", badge: "4", severity: "minor" },
    { text: "Now", badge: "3", severity: "minor" },
    { text: "11", badge: "3", severity: "minor" },
    { text: "21", badge: "5", severity: "major" },
    { text: "25", badge: "12", severity: "major" },
    { text: "45", badge: "5", severity: "major" }
  ]));
  expect(marks).toHaveLength(8);   // 149 s and 124 s delays are ignored
  const ticker = await page.textContent("#ticker-text");
  expect(ticker.startsWith("⚠ Richmond train in 25 min is running 12 min late")).toBe(true);
});

test("ticker: hidden with nothing to report, shows advisories, scrolls when long", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page, { etd: SCENARIOS.normal });
  expect(await page.isHidden("#ticker")).toBe(true);
  await openBoard(page, { etd: SCENARIOS.delays, bsa: ADVISORY });
  expect(await page.isVisible("#ticker")).toBe(true);
  expect(await page.textContent("#ticker-text")).toContain("BART: Major delays systemwide");
  expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
});

test("when BART stops responding: minutes count down, then the board fades with the data time", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date("2026-11-02T20:00:00Z") });   // noon, train screen
  let fail = false;
  await openBoard(page, {
    time: null,
    departures: () => fail ? json({ error: "down" }, 500) : json({ root: { station: [{ etd: SCENARIOS.normal }] } })
  });
  expect((await columnSummary(page))["col-rich"].text[0]).toBe("12");

  fail = true;
  await page.clock.runFor(30 * 1000);   // 1st failed refresh
  expect(await page.textContent("#status")).toContain("Update failed");
  expect(await page.evaluate(() => document.querySelector("main").classList.contains("stale"))).toBe(false);

  await page.clock.runFor(2 * 60 * 1000);   // more failures, 2.5 minutes after the last good data
  expect(await page.evaluate(() => document.querySelector("main").classList.contains("stale"))).toBe(true);
  expect(await page.textContent("#status")).toMatch(/^Data from \d+:\d\d (AM|PM)/);
  expect((await columnSummary(page))["col-rich"].text[0]).toBe("10");   // 12 -> 10 after 2 full minutes

  fail = false;
  await page.clock.runFor(30 * 1000);   // recovers
  expect(await page.evaluate(() => document.querySelector("main").classList.contains("stale"))).toBe(false);
  expect(await page.textContent("#status")).toMatch(/^Updated/);
});

test("divider: drag changes the split, it's remembered, double-tap resets to 40%", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page);
  const split = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("main")).getPropertyValue("--split")));
  expect(await split()).toBeCloseTo(0.4, 2);
  const d = await page.locator("#divider").boundingBox();
  await page.mouse.move(d.x + d.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(640, 400, { steps: 8 });
  await page.mouse.up();
  expect(await split()).toBeCloseTo(0.5, 1);
  expect(await layoutProblems(page)).toEqual([]);
  await page.reload();
  await page.waitForSelector(".train");
  expect(await split()).toBeCloseTo(0.5, 1);
  const d2 = await page.locator("#divider").boundingBox();
  await page.mouse.dblclick(d2.x + d2.width / 2, 400);
  expect(await split()).toBeCloseTo(0.4, 2);
});

test("browser text zoom: numbers shrink until everything fits", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await openBoard(page, { etd: SCENARIOS.delays, bsa: ADVISORY });
  // Simulate a 130% text zoom, which the CSS formula can't know about.
  await page.addStyleTag({ content: ".mins { font-size: calc(var(--num) * 1.3) } .mins.leaving { font-size: calc(var(--now) * 1.3) } .late-badge { font-size: calc(var(--num) * 0.34) }" });
  await page.evaluate(() => fitAll());
  expect(await layoutProblems(page)).toEqual([]);
});
