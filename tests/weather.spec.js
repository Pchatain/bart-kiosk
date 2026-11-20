// Weather screen: schedule, tap-to-switch, tides, sunrise, rain, the wind page, and layout.
const { test, expect } = require("@playwright/test");
const { openBoard, woofFixture, ESTUARY_MAP, noaaFixture } = require("./helpers");

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

test("rain: none, and an afternoon of rain by amount", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  expect(await page.textContent("#rain-body .wx-headline")).toBe("No rain expected");
  expect(await page.textContent("#rain-body .wx-detail")).toBe("Dry all day and tonight");
  expect(await page.locator(".rain-bar").count()).toBe(24);
  expect(await page.locator(".rain-bar.wet, .rain-bar.heavy").count()).toBe(0);

  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  const rainy = woofFixture(fiveAm, i => (i >= 9 && i <= 12 ? 0.05 : i === 13 ? 0.004 : 0));   // 2-6 PM, then a trace
  await openBoard(page, { time: AT["5:30 AM"], weather: rainy });
  const headline = (await page.textContent("#rain-body .wx-headline")).replace(/\s/g, " ");
  expect(headline).toBe("Rain 2 PM – 6 PM");
  expect((await page.textContent("#rain-body .wx-detail")).replace(/\s/g, " ")).toBe("About 0.20 in total · peak 0.05 in/hr");
  expect(await page.locator(".rain-bar.wet").count()).toBe(4);
  // Bars sit on the hour the rain falls in: the 10th bar (2 PM) is the first wet one.
  expect(await page.evaluate(() => [...document.querySelectorAll(".rain-bar")].findIndex(b => b.classList.contains("wet")))).toBe(9);
});

test("rain: heavy rain, and a forecast that ends before 24 hours", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  await openBoard(page, { time: AT["5:30 AM"], weather: woofFixture(fiveAm, i => (i === 3 ? 0.15 : i === 4 ? 0.02 : 0)) });
  expect((await page.textContent("#rain-body .wx-headline")).replace(/\s/g, " ")).toBe("Heavy rain 8 AM – 10 AM");
  expect(await page.locator(".rain-bar.heavy").count()).toBe(1);

  const short = woofFixture(fiveAm);
  for (const key of Object.keys(short.boathouse)) short.boathouse[key] = short.boathouse[key].slice(0, 13);   // forecast ends 5 PM
  await openBoard(page, { time: AT["5:30 AM"], weather: short });
  expect(await page.locator(".rain-bar").count()).toBe(12);
  expect((await page.textContent("#rain-body .wx-detail")).replace(/\s/g, " ")).toBe("Dry until at least 5 PM");
});

test("forecast file out of date: treated as unavailable", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], weather: woofFixture(Date.parse("2026-10-30T13:00:00Z")) });
  expect(await page.textContent("#rain-body")).toContain("Forecast unavailable");
  expect(await page.textContent("#status")).toContain("Weather update failed");
});

test("weather service down: says so, keeps sunrise and tides", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], weather: 500 });
  expect(await page.textContent("#rain-body")).toContain("Forecast unavailable");
  expect(await page.textContent("#sun-body")).toContain("6:35");
  expect(await page.textContent("#tide-body .wx-headline")).toContain("Low tide");
  expect(await page.textContent("#status")).toContain("Weather update failed");
});

// ---- Wind page ----
const windRows = page => page.evaluate(() => [...document.querySelectorAll(".wind-row")].map(r => r.querySelector(".wind-info").innerText.replace(/\s+/g, " ").trim()));
// 4-8 mph from the east at 7 AM (windiest at the Jack London end), calm northerly by 9.
const morningWind = (i, hour) => {
  const along = ESTUARY_MAP.points[i].x / 1100;
  return hour <= 7 ? { mph: 8 - 4 * Math.min(Math.max(along, 0), 1), from: 90 } : hour === 8 ? { mph: 3, from: 45 } : { mph: 1.4, from: 0 };
};

test("wind page: a row each for 7, 8 and 9 AM with the range along the course", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: woofFixture(fiveAm, () => 0, morningWind) });
  expect(await page.isVisible("#wind")).toBe(true);
  expect(await page.isHidden("#weather")).toBe(true);
  expect(await page.textContent("h1")).toBe("Fruitvale Wind");
  expect(await windRows(page)).toEqual(["7 AM 4–8 mph from E · gusts 11", "8 AM 3 mph from NE · gusts 6", "9 AM 1 mph from N · gusts 4"]);
  // Each row has a map with the water, streaks on the water and along the course, and both ends marked.
  for (const row of await page.locator(".wind-row").all()) {
    expect(await row.locator("svg > path[fill-rule]").count()).toBe(1);
    expect(await row.locator("svg g path").count()).toBeGreaterThan(2);
    expect(await row.locator("svg circle").count()).toBeGreaterThanOrEqual(3);
  }
  const labels = await page.locator(".wind-row").first().locator("svg text").allTextContents();
  expect(labels).toEqual(expect.arrayContaining(["Jack London", "Boathouse", "The Pitt"]));
  expect(await page.textContent("#footer-note")).toContain("Forecast by WOOF, Recast");
});

test("wind page: streaks point the way the wind blows on the turned map", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  // Wind from the north-west blows towards the south-east: left to right on the turned map.
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: woofFixture(fiveAm, () => 0, () => ({ mph: 6, from: 270 - ESTUARY_MAP.northDeg })) });
  const d = await page.locator(".wind-row").first().locator("svg g").last().locator("path").first().getAttribute("d");
  const [, x1, y1, x2, y2] = d.match(/^M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)/).map(Number);
  expect(x2 - x1).toBeGreaterThan(20);
  expect(Math.abs(y2 - y1)).toBeLessThan(1);
});

test("wind page: tomorrow's rows after practice; hours the forecast lacks say so", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  const wx = woofFixture(fiveAm, () => 0, morningWind);
  await openBoard(page, { time: "2026-11-02T17:00:00Z", query: "?screen=wind", weather: wx });   // 9 AM
  expect((await windRows(page))[0]).toBe("7 AM tomorrow 4–8 mph from E · gusts 11");
  const partial = { ...wx, wind: wx.wind.filter(w => new Date(w.time * 1000).getUTCHours() !== 16) };   // no 8 AM
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: partial });
  expect((await windRows(page))[1]).toBe("8 AM No forecast yet");
  expect(await page.locator(".wind-row svg").count()).toBe(2);
});

test("wind page: forecast unavailable", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: 500 });
  expect(await page.textContent("#wind")).toContain("Wind forecast unavailable");
});

test("weather screen alternates tides and wind every 20 seconds; a tap switches now", async ({ page }) => {
  await page.clock.install({ time: new Date(AT["5:30 AM"]) });
  await openBoard(page, { time: null });
  const shown = () => page.evaluate(() => (!document.getElementById("wind").hidden ? "wind" : !document.getElementById("weather").hidden ? "tides" : "trains"));
  expect(await shown()).toBe("tides");
  await page.clock.runFor(21 * 1000);
  expect(await shown()).toBe("wind");
  await page.clock.runFor(20 * 1000);
  expect(await shown()).toBe("tides");
  await page.click("#weather");
  expect(await shown()).toBe("wind");
  await page.clock.runFor(19 * 1000);
  expect(await shown()).toBe("wind");
  await page.clock.runFor(2 * 1000);
  expect(await shown()).toBe("tides");
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
      weather: woofFixture(fiveAm, i => (i >= 9 && i <= 12 ? 0.12 : i === 20 ? 0.02 : 0)) });
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

for (const vp of [
  { name: "fire-hd8", width: 960, height: 600, deviceScaleFactor: 4 / 3 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "ipad-portrait", width: 768, height: 1024 },
  { name: "phone-portrait", width: 390, height: 844 }
]) {
  test(`wind layout fits: ${vp.name}`, async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    const fiveAm = Date.parse("2026-11-02T13:00:00Z");
    await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: woofFixture(fiveAm, () => 0, (i, hour) => ({ mph: hour === 7 ? 12.4 + (i % 7) : 6, from: 120 })) });
    if (vp.name === "fire-hd8") await testInfo.attach("wind-fire-hd8", { body: await page.screenshot(), contentType: "image/png" });
    const problems = await page.evaluate(() => {
      const out = [];
      const rows = [...document.querySelectorAll(".wind-row")];
      if (rows.length !== 3) out.push(`expected 3 rows, got ${rows.length}`);
      for (const row of rows) {
        const info = row.querySelector(".wind-info"), map = row.querySelector(".wind-map");
        if (info.scrollWidth > info.clientWidth + 1 || info.scrollHeight > info.clientHeight + 1) out.push(`"${info.innerText}": text cut off`);
        if (map.clientWidth < 150 || map.clientHeight < 40) out.push(`map too small (${map.clientWidth}x${map.clientHeight})`);
        const box = map.getBoundingClientRect();
        // Both ends of the course are inside the map.
        for (const c of map.querySelectorAll("circle")) {
          const r = c.getBoundingClientRect();
          if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) out.push("a course marker is outside the map");
        }
        for (const t of map.querySelectorAll("text")) {
          const r = t.getBoundingClientRect();
          if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) out.push(`label "${t.textContent}" outside the map`);
        }
      }
      const doc = document.documentElement;
      if (doc.scrollWidth > innerWidth || doc.scrollHeight > innerHeight) out.push("page scrolls");
      return out;
    });
    expect(problems).toEqual([]);
    await page.close();
  });
}
