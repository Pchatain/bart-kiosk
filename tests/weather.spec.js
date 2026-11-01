// Weather screen: schedule, tap-to-switch, tides, sunrise, rain, and layout.
const { test, expect } = require("@playwright/test");
const { openBoard, openMeteoFixture, noaaFixture } = require("./helpers");

// Monday 2 Nov 2026, Bay Area time (PST = UTC-8).
const AT = {
  "4:59 AM": "2026-11-02T12:59:00Z",
  "5:30 AM": "2026-11-02T13:30:00Z",
  "7:05 AM": "2026-11-02T15:05:00Z",
  "noon": "2026-11-02T20:00:00Z"
};
const screen = page => page.evaluate(() => document.body.classList.contains("show-weather") ? "weather" : "trains");

test("schedule: weather from 5:00 to 7:00 AM, trains otherwise", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  expect(await screen(page)).toBe("weather");
  expect(await page.isVisible("#weather")).toBe(true);
  expect(await page.isHidden("main")).toBe(true);
  expect(await page.textContent("h1")).toBe("Fruitvale Weather");
  for (const t of ["4:59 AM", "7:05 AM", "noon"]) {
    await openBoard(page, { time: AT[t] });
    expect(await screen(page), t).toBe("trains");
  }
});

test("tap the icon at noon: weather for 5 minutes, then back to trains", async ({ page }) => {
  await page.clock.install({ time: new Date(AT.noon) });
  await openBoard(page, { time: null });
  expect(await screen(page)).toBe("trains");
  await page.click("#screen-toggle");
  expect(await screen(page)).toBe("weather");
  await page.clock.runFor(4 * 60 * 1000);
  expect(await screen(page)).toBe("weather");
  await page.clock.runFor(61 * 1000);
  expect(await screen(page)).toBe("trains");
});

test("tap during weather time: trains for 5 minutes, then weather again; a second tap switches straight back", async ({ page }) => {
  await page.clock.install({ time: new Date(AT["5:30 AM"]) });
  await openBoard(page, { time: null });
  expect(await screen(page)).toBe("weather");
  await page.click("#screen-toggle");
  expect(await screen(page)).toBe("trains");
  await page.clock.runFor(5 * 60 * 1000 + 2000);
  expect(await screen(page)).toBe("weather");
  await page.click("#screen-toggle");
  await page.click("#screen-toggle");
  expect(await screen(page)).toBe("weather");
});

test("tides: turns during practice", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], tides: noaaFixture(Date.parse("2026-11-02T15:44:00Z")) });   // low 7:44 AM
  expect(await page.textContent("#tide-label")).toMatch(/today 6:30\sAM.8:30\sAM/i);
  expect(await page.textContent("#tide-body .wx-headline")).toBe("Low tide at 7:44 AM: falling, then rising".replace(" ", await page.evaluate(() => formatTime(new Date(0), false).match(/\s/)[0])));
  expect(await page.locator("#tide-chart svg path").count()).toBe(2);
  expect(await page.textContent("#tide-chart svg")).toContain("Practice");
});

test("tides: rising all practice; after practice it shows tomorrow", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], tides: noaaFixture(Date.parse("2026-11-02T12:00:00Z")) });   // low 4 AM, high ~10:13 AM
  expect(await page.textContent("#tide-body .wx-headline")).toBe("Rising all practice");
  await openBoard(page, { time: "2026-11-02T17:00:00Z", query: "?screen=weather", tides: noaaFixture(Date.parse("2026-11-02T12:00:00Z")) });   // 9 AM
  expect(await page.textContent("#tide-label")).toMatch(/tomorrow/i);
});

test("sunrise, first light and sunset for the practice day", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  const text = (await page.textContent("#sun-body")).replace(/\s/g, " ");
  expect(text).toContain("6:35 AM");                 // sunrise (reference: 6:35:46)
  expect(text).toContain("First light 6:08 AM");     // civil dawn (reference: 6:07:59)
  expect(text).toContain("Sunset 5:09 PM");          // (reference: 5:08:42)
  expect(text).toContain("Now 54°F · Wind 8 mph from W");
});

test("rain: none, and a likely afternoon window", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  expect(await page.textContent("#rain-body .wx-headline")).toBe("No rain expected");
  expect(await page.locator(".rain-bar").count()).toBe(24);

  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  const rainy = openMeteoFixture(fiveAm, i => (i >= 9 && i <= 12 ? 70 : 10), i => (i >= 9 && i <= 12 ? 0.05 : 0));   // 2-6 PM
  await openBoard(page, { time: AT["5:30 AM"], weather: rainy });
  const headline = (await page.textContent("#rain-body .wx-headline")).replace(/\s/g, " ");
  expect(headline).toBe("Rain likely 2 PM – 6 PM");
  expect((await page.textContent("#rain-body .wx-detail")).replace(/\s/g, " ")).toContain("Up to 70% chance · about 0.20 in");
  expect(await page.locator(".rain-bar.likely").count()).toBe(4);
});

test("weather service down: says so, keeps sunrise and tides", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], weather: 500 });
  expect(await page.textContent("#rain-body")).toContain("Forecast unavailable");
  expect(await page.textContent("#sun-body")).toContain("6:35");
  expect(await page.textContent("#tide-body .wx-headline")).toContain("Low tide");
  expect(await page.textContent("#status")).toContain("Weather update failed");
});

// Nothing spills out of the weather cards on any screen.
for (const vp of [
  { name: "fire-hd8", width: 960, height: 600, deviceScaleFactor: 4 / 3 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "ipad-portrait", width: 768, height: 1024 },
  { name: "phone-portrait", width: 390, height: 844 }
]) {
  for (const [tideCase, lowAt] of [["low in practice", "2026-11-02T15:44:00Z"], ["high in practice", "2026-11-02T08:47:00Z"]]) {
  test(`weather layout fits: ${vp.name} / ${tideCase}`, async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    const fiveAm = Date.parse("2026-11-02T13:00:00Z");
    await openBoard(page, { time: AT["5:30 AM"], tides: noaaFixture(Date.parse(lowAt)),
      weather: openMeteoFixture(fiveAm, i => (i >= 9 && i <= 12 ? 70 : i === 20 ? 35 : 5), () => 0.03) });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (vp.name === "fire-hd8") await testInfo.attach(`weather-fire-hd8-${tideCase}`, { body: await page.screenshot(), contentType: "image/png" });
    const problems = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll(".wx-card")) {
        if (card.scrollHeight > card.clientHeight + 1) out.push(`${card.className}: content cut off at the bottom`);
        if (card.scrollWidth > card.clientWidth + 1) out.push(`${card.className}: content cut off at the side`);
      }
      const chart = document.querySelector("#tide-chart");
      if (chart.clientHeight < 40) out.push(`tide chart too small (${chart.clientHeight}px)`);
      const labels = [...document.querySelectorAll("#tide-chart text")].map(t => ({ text: t.textContent, r: t.getBoundingClientRect() }));
      const c = chart.getBoundingClientRect();
      labels.forEach((a, i) => {
        if (a.r.left < c.left - 2 || a.r.right > c.right + 2) out.push(`chart label "${a.text}" outside the chart`);
        for (const b of labels.slice(i + 1)) {
          if (a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) out.push(`chart labels overlap: "${a.text}" / "${b.text}"`);
        }
      });
      const doc = document.documentElement;
      if (doc.scrollWidth > innerWidth || doc.scrollHeight > innerHeight) out.push("page scrolls");
      return out;
    });
    expect(problems).toEqual([]);
    await page.close();
  });
  }
}
