// Weather screen: schedule, tap-to-switch, the strip of numbers (tide, rain, sunrise, now), the wind maps, and layout.
const { test, expect } = require("@playwright/test");
const { openBoard, woofFixture, ESTUARY_MAP, noaaFixture } = require("./helpers");

// Monday 2 Nov 2026, Bay Area time (PST = UTC-8).
const AT = {
  "4:59 AM": "2026-11-02T12:59:00Z",
  "5:30 AM": "2026-11-02T13:30:00Z",
  "7:05 AM": "2026-11-02T15:05:00Z",
  "noon": "2026-11-02T20:00:00Z"
};
// A tile's text as "label | value | detail", with plain spaces.
const tile = async (page, id) => (await page.locator(`#tile-${id} > div`).allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim()).join(" | ");
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

test("one screen: the numbers and the wind maps show together", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  expect(await page.locator(".wx-tile").count()).toBe(4);
  for (const t of await page.locator(".wx-tile").all()) expect(await t.isVisible()).toBe(true);
  expect(await page.locator(".wind-row").count()).toBe(3);
  expect(await page.locator(".wind-row svg").first().isVisible()).toBe(true);
  // It stays put: no second page to switch to, by waiting or by tapping.
  await page.click("#wx-strip");
  await page.click("#wind");
  expect(await page.isVisible("#wx-strip")).toBe(true);
  expect(await page.isVisible("#wind")).toBe(true);
  expect(await page.textContent("h1")).toBe("Fruitvale Weather");
});

test("tide: heights at the start and end of practice, and the turn in between", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], tides: noaaFixture(Date.parse("2026-11-02T15:44:00Z")) });   // low 7:44 AM
  expect(await tile(page, "tide")).toBe("TIDE · 6:30–8:30 | 0.2 → −0.2 ft | Low −0.4 ft at 7:44 AM");
  await openBoard(page, { time: AT["5:30 AM"], tides: noaaFixture(Date.parse("2026-11-02T08:47:00Z")) });   // high 6:59 AM
  expect(await tile(page, "tide")).toBe("TIDE · 6:30–8:30 | 5.5 → 4.8 ft | High 5.6 ft at 6:59 AM");
});

test("tide: rising all practice; after practice it shows tomorrow", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], tides: noaaFixture(Date.parse("2026-11-02T12:00:00Z")) });   // low 4 AM, high ~10:12 AM
  expect(await tile(page, "tide")).toBe("TIDE · 6:30–8:30 | 1.7 → 4.5 ft | Rising · high 10:12 AM");
  await openBoard(page, { time: "2026-11-02T17:00:00Z", query: "?screen=weather", tides: noaaFixture(Date.parse("2026-11-02T12:00:00Z")) });   // 9 AM
  expect(await tile(page, "tide")).toMatch(/^TIDE TOMORROW · 6:30–8:30 \| /);
  expect(await tile(page, "sun")).toMatch(/^SUNRISE TOMORROW \| /);
});

test("sunrise, first light and sunset for the practice day; temperature and wind now", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  // References: sunrise 6:35:46, civil dawn 6:07:59, sunset 5:08:42.
  expect(await tile(page, "sun")).toBe("SUNRISE | 6:35 AM | First light 6:08 · sunset 5:09");
  expect(await tile(page, "now")).toBe("NOW | 54°F | Wind 8 mph W");
});

test("rain: none, and an afternoon of rain by amount", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"] });
  expect(await tile(page, "rain")).toBe("RAIN · NEXT 24 HR | 0 in | Dry all day and night");

  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  const rainy = woofFixture(fiveAm, i => (i >= 9 && i <= 12 ? 0.05 : i === 13 ? 0.004 : 0));   // 2-6 PM, then a trace
  await openBoard(page, { time: AT["5:30 AM"], weather: rainy });
  expect(await tile(page, "rain")).toBe("RAIN · NEXT 24 HR | 0.20 in | 2 PM – 6 PM");
  expect(await page.locator("#tile-rain .wx-value.heavy").count()).toBe(0);
});

test("rain: heavy rain, a second spell, and a forecast that ends before 24 hours", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  await openBoard(page, { time: AT["5:30 AM"], weather: woofFixture(fiveAm, i => (i === 3 ? 0.15 : i === 4 ? 0.02 : 0)) });
  expect(await tile(page, "rain")).toBe("RAIN · NEXT 24 HR | 0.17 in | Heavy 8 AM – 10 AM");
  expect(await page.locator("#tile-rain .wx-value.heavy").count()).toBe(1);

  await openBoard(page, { time: AT["5:30 AM"], weather: woofFixture(fiveAm, i => (i === 0 || i === 15 ? 0.03 : 0)) });   // now, and 8 PM
  expect(await tile(page, "rain")).toBe("RAIN · NEXT 24 HR | 0.06 in | now – 6 AM & later");

  const short = woofFixture(fiveAm);
  for (const key of Object.keys(short.boathouse)) short.boathouse[key] = short.boathouse[key].slice(0, 13);   // forecast ends 5 PM
  await openBoard(page, { time: AT["5:30 AM"], weather: short });
  expect(await tile(page, "rain")).toBe("RAIN · NEXT 24 HR | 0 in | Dry until 5 PM");
});

test("forecast file out of date: treated as unavailable", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], weather: woofFixture(Date.parse("2026-10-30T13:00:00Z")) });
  expect(await tile(page, "rain")).toBe("RAIN · NEXT 24 HR | – | Unavailable — retrying");
  expect(await page.textContent("#status")).toContain("Weather update failed");
});

test("weather service down: says so, keeps sunrise and tides", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], weather: 500 });
  expect(await tile(page, "rain")).toContain("Unavailable");
  expect(await tile(page, "now")).toContain("Unavailable");
  expect(await page.textContent("#wind")).toContain("Wind forecast unavailable");
  expect(await tile(page, "sun")).toContain("6:35 AM");
  expect(await tile(page, "tide")).toContain("Low −0.4 ft");
  expect(await page.textContent("#status")).toContain("Weather update failed");
});

test("tide service down: says so, keeps the rest", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], tides: 500 });
  expect(await tile(page, "tide")).toBe("TIDE · 6:30–8:30 | – | Unavailable — retrying");
  expect(await tile(page, "rain")).toContain("Dry all day");
  expect(await page.locator(".wind-row svg").count()).toBe(3);
});

test("forecast stops updating: keeps the last one and says when it's from", async ({ page }) => {
  await page.clock.install({ time: new Date(AT["5:30 AM"]) });
  let wx = woofFixture(Date.parse("2026-11-02T13:00:00Z"));
  await openBoard(page, { time: null, weather: wx });
  await page.unroute("https://raw.githubusercontent.com/**");
  await page.route("https://raw.githubusercontent.com/**", route => route.fulfill({ status: 500, body: "down" }));
  await page.clock.runFor(15 * 60 * 1000 + 1000);
  expect((await page.textContent("#status")).replace(/\s/g, " ")).toBe("Weather from 5:30 AM — retrying");
  expect(await tile(page, "now")).toBe("NOW | 54°F | Wind 8 mph W");
  expect(await page.locator(".wind-row svg").count()).toBe(3);
});

// ---- Wind maps ----
const windRows = page => page.evaluate(() => [...document.querySelectorAll(".wind-row")].map(r => r.querySelector(".wind-info").innerText.replace(/\s+/g, " ").trim()));
// 4-8 mph from the east at 7 AM (windiest at the Jack London end), calm northerly by 9.
const morningWind = (i, hour) => {
  const along = ESTUARY_MAP.points[i].x / 1100;
  return hour <= 7 ? { mph: 8 - 4 * Math.min(Math.max(along, 0), 1), from: 90 } : hour === 8 ? { mph: 3, from: 45 } : { mph: 1.4, from: 0 };
};

test("wind: a row each for 7, 8 and 9 AM with the range along the course", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: woofFixture(fiveAm, () => 0, morningWind) });
  expect(await page.isVisible("#wind")).toBe(true);
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

test("wind: streaks point the way the wind blows on the turned map", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  // Wind from the north-west blows towards the south-east: left to right on the turned map.
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: woofFixture(fiveAm, () => 0, () => ({ mph: 6, from: 270 - ESTUARY_MAP.northDeg })) });
  const d = await page.locator(".wind-row").first().locator("svg g").last().locator("path").first().getAttribute("d");
  const [, x1, y1, x2, y2] = d.match(/^M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)/).map(Number);
  expect(x2 - x1).toBeGreaterThan(20);
  expect(Math.abs(y2 - y1)).toBeLessThan(1);
});

test("wind: tomorrow's rows after practice; hours the forecast lacks say so", async ({ page }) => {
  const fiveAm = Date.parse("2026-11-02T13:00:00Z");
  const wx = woofFixture(fiveAm, () => 0, morningWind);
  await openBoard(page, { time: "2026-11-02T17:00:00Z", query: "?screen=wind", weather: wx });   // 9 AM
  expect((await windRows(page))[0]).toBe("7 AM tomorrow 4–8 mph from E · gusts 11");
  const partial = { ...wx, wind: wx.wind.filter(w => new Date(w.time * 1000).getUTCHours() !== 16) };   // no 8 AM
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: partial });
  expect((await windRows(page))[1]).toBe("8 AM No forecast yet");
  expect(await page.locator(".wind-row svg").count()).toBe(2);
});

test("wind: forecast unavailable", async ({ page }) => {
  await openBoard(page, { time: AT["5:30 AM"], query: "?screen=wind", weather: 500 });
  expect(await page.textContent("#wind")).toContain("Wind forecast unavailable");
});

// The whole weather screen fits: no number or label cut off, the maps keep a useful size.
for (const vp of [
  { name: "fire-hd8", width: 960, height: 600, deviceScaleFactor: 4 / 3 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "ipad-portrait", width: 768, height: 1024 },
  { name: "phone-portrait", width: 390, height: 844 }
]) {
  test(`weather layout fits: ${vp.name}`, async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    const fiveAm = Date.parse("2026-11-02T13:00:00Z");
    // The widest text each tile shows: a negative tide, heavy rain with a second spell, tomorrow's practice.
    await openBoard(page, { time: "2026-11-02T17:00:00Z", query: "?screen=weather", tides: noaaFixture(Date.parse("2026-11-03T15:44:00Z"), { fromMs: Date.parse("2026-11-02T08:00:00Z") }),
      weather: woofFixture(fiveAm, i => (i >= 9 && i <= 12 ? 0.12 : i === 20 ? 0.02 : 0), (i, hour) => ({ mph: hour === 7 ? 12.4 + (i % 7) : 6, from: 120 })) });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (vp.name === "fire-hd8") await testInfo.attach("weather-fire-hd8", { body: await page.screenshot(), contentType: "image/png" });
    const problems = await page.evaluate(() => {
      const out = [];
      const tiles = [...document.querySelectorAll(".wx-tile")];
      if (tiles.length !== 4) out.push(`expected 4 tiles, got ${tiles.length}`);
      for (const line of document.querySelectorAll(".wx-tile > div")) {
        if (line.scrollWidth > line.clientWidth + 1 || line.scrollHeight > line.clientHeight + 1) out.push(`"${line.innerText}": text cut off`);
      }
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
