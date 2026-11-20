// Shared helpers for the layout tests: fake BART data, opening the board, and
// a geometry check that reports anything clipped, overlapping or cut off.
const fs = require("fs");
const path = require("path");

const PAGE_URL = "file://" + path.resolve(__dirname, "..", "index.html");

const ORANGE = "#ff9933", BLUE = "#0099cc", GREEN = "#339933", YELLOW = "#ffff33";

// One estimate as BART's API returns it. minutes: number or "Leaving"; delay in seconds.
function est(minutes, platform, hexcolor, delay = 0) {
  return { minutes: String(minutes), platform: String(platform), hexcolor, cancelflag: "0", delay: String(delay) };
}

const SCENARIOS = {
  // Typical: 3 trains per destination.
  normal: [
    { destination: "Berryessa", estimate: [est(5, 1, ORANGE), est(25, 1, ORANGE), est(45, 1, ORANGE)] },
    { destination: "Dublin/Pleasanton", estimate: [est(9, 1, BLUE), est(29, 1, BLUE), est(49, 1, BLUE)] },
    { destination: "Daly City", estimate: [est(2, 2, BLUE), est(22, 2, BLUE), est(42, 2, BLUE)] },
    { destination: "Richmond", estimate: [est(12, 2, ORANGE), est(32, 2, ORANGE), est(52, 2, ORANGE)] }
  ],
  // Two lines sharing columns: more than 4 trains in some columns.
  busy: [
    { destination: "Berryessa", estimate: [est("Leaving", 1, ORANGE), est(8, 1, GREEN), est(16, 1, ORANGE), est(28, 1, GREEN), est(36, 1, ORANGE)] },
    { destination: "Dublin/Pleasanton", estimate: [est(4, 1, BLUE), est(24, 1, BLUE), est(44, 1, BLUE)] },
    { destination: "Daly City", estimate: [est(2, 2, BLUE), est(10, 2, GREEN), est(22, 2, BLUE), est(30, 2, GREEN)] },
    { destination: "SF Airport", estimate: [est(6, 2, YELLOW), est(26, 2, YELLOW)] },
    { destination: "Richmond", estimate: [est(7, 2, ORANGE), est(27, 2, ORANGE), est(47, 2, ORANGE)] }
  ],
  // Late trains, including a late "Now" and a two-digit delay.
  delays: [
    { destination: "Berryessa", estimate: [est("Leaving", 1, GREEN, 600), est(16, 1, ORANGE, 149), est(36, 1, ORANGE, 150)] },
    { destination: "Dublin/Pleasanton", estimate: [est(4, 1, BLUE, 124), est(24, 1, BLUE, 240), est(44, 1, BLUE)] },
    { destination: "Daly City", estimate: [est("Leaving", 2, GREEN, 180), est(11, 2, BLUE, 180), est(21, 2, BLUE, 299)] },
    { destination: "Richmond", estimate: [est(7, 2, ORANGE), est(25, 2, ORANGE, 720), est(45, 2, ORANGE, 300)] }
  ],
  // Late night: some columns empty.
  sparse: [
    { destination: "Daly City", estimate: [est(17, 2, BLUE)] },
    { destination: "Richmond", estimate: [est(7, 2, ORANGE)] }
  ]
};

const NO_ADVISORIES = { root: { bsa: [{ station: "", description: { "#cdata-section": "No advisories issued." } }] } };
const ADVISORY = { root: { bsa: [{ station: "", description: { "#cdata-section": "Major delays systemwide due to an earlier equipment problem." } }] } };

// Noon on a Monday, Bay Area time: the train screen is showing.
const NOON = "2026-11-02T20:00:00Z";

// The course map the page loads (the real file) and a forecast in the format of
// data/estuary-wind.json: 48 hours from `startMs`. rainIn(hourIndex) is the rain during
// each hour; wind(pointIndex, hourOfDay) gives { mph, from } at each map point.
const ESTUARY_MAP = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "data", "estuary-map.json"), "utf8"));
const laHour = ms => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(ms)) % 24;

function woofFixture(startMs, rainIn = () => 0, wind = () => ({ mph: 5, from: 90 })) {
  const hours = [...Array(49).keys()].map(i => startMs + i * 3600000);
  const points = ESTUARY_MAP.points.map((p, i) => i);
  return {
    source: "WOOF, Recast", forecast: "test", run: "run_test_" + startMs, init: new Date(startMs).toISOString(), points: points.length,
    boathouse: {
      time: hours.map(t => t / 1000),
      tempF: hours.map(() => 54), windMph: hours.map(() => 7.8), windFromDeg: hours.map(() => 270), gustMph: hours.map(() => 12),
      rainIn: hours.map((t, i) => (i === 0 ? null : rainIn(i - 1))),   // WOOF: the total over the hour before each time
      visibilityMi: hours.map(() => 10), lowCloudPct: hours.map(() => 0)
    },
    wind: hours.filter(t => laHour(t) >= 5 && laHour(t) <= 10).map(t => {
      const at = points.map(i => wind(i, laHour(t)));
      return { time: t / 1000, speedMph: at.map(w => w.mph), fromDeg: at.map(w => w.from), gustMph: at.map(w => Math.round(w.mph + 3)) };
    })
  };
}

// NOAA predictions (hilo and 6-minute curve) for a simple tide with a low at `lowMs`.
function noaaFixture(lowMs, { lowFt = -0.4, highFt = 5.6, fromMs = lowMs - 36 * 3600000 } = {}) {
  const period = 12.42 * 3600000, mid = (lowFt + highFt) / 2, amp = (highFt - lowFt) / 2;
  const fmt = t => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  const curve = [], hilo = [];
  for (let t = fromMs; t < fromMs + 72 * 3600000; t += 6 * 60000) {
    curve.push({ t: fmt(t), v: (mid - amp * Math.cos(2 * Math.PI * (t - lowMs) / period)).toFixed(3) });
  }
  for (let k = -6; k <= 6; k++) {
    const t = lowMs + k * period / 2;
    if (t >= fromMs && t < fromMs + 72 * 3600000) hilo.push({ t: fmt(t), v: String(k % 2 ? highFt : lowFt), type: k % 2 ? "H" : "L" });
  }
  return { hilo: { predictions: hilo }, curve: { predictions: curve } };
}

function json(body, status = 200) {
  return { status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}

// Opens the board with fake BART responses. `departures` may be a function
// (called per request) to change the data or fail between refreshes.
// `time`: what the page's clock says (default: noon, trains). Pass null if the
// test installed its own clock. `weather` (a woofFixture) / `tides`: responses, or a status code to fail.
async function openBoard(page, { etd = SCENARIOS.normal, bsa = NO_ADVISORIES, query = "", departures, time = NOON, weather, tides } = {}) {
  if (time !== null) await page.clock.setFixedTime(new Date(time));
  const now = time !== null ? Date.parse(time) : Date.parse(NOON);
  const hourStart = now - (now % 3600000);
  const wx = weather === undefined ? woofFixture(hourStart) : weather;
  const td = tides === undefined ? noaaFixture(Date.parse("2026-11-02T15:44:00Z")) : tides;
  await page.route("https://api.bart.gov/api/etd.aspx**", route =>
    route.fulfill(departures ? departures() : json({ root: { station: [{ etd }] } })));
  await page.route("https://api.bart.gov/api/bsa.aspx**", route => route.fulfill(json(bsa)));
  await page.route("https://raw.githubusercontent.com/**", route =>
    route.fulfill(typeof wx === "number" ? json({ error: true }, wx) : json(route.request().url().endsWith("estuary-map.json") ? ESTUARY_MAP : wx)));
  await page.route("https://api.tidesandcurrents.noaa.gov/**", route =>
    route.fulfill(typeof td === "number" ? json({ error: true }, td) : json(route.request().url().includes("interval=hilo") ? td.hilo : td.curve)));
  await page.goto(PAGE_URL + query);
  // The first refresh has finished (successfully or not) once the status changes.
  await page.waitForFunction(() => !document.getElementById("status").textContent.startsWith("Updating"));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// Everything that would look broken on the board. Returns a list of problems (empty = OK).
async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    const rect = el => el.getBoundingClientRect();
    const textRect = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
    for (const col of document.querySelectorAll(".trains")) {
      const box = rect(col);
      for (const row of col.querySelectorAll(".train")) {
        const label = `${col.id} "${row.textContent}"`;
        if (rect(row).bottom > box.bottom + 1) problems.push(`${label}: row cut off at the bottom`);
        const mins = row.querySelector(".mins");
        const digits = mins.querySelector("span");
        const own = rect(mins), text = textRect(digits);
        if (text.right > box.right + 1) problems.push(`${label}: number clipped on the right`);
        if (text.right > own.right + 1 || text.left < own.left - 1) problems.push(`${label}: number spills out of its outline`);
        if (text.left < rect(row.querySelector(".line-dot")).right + 1) problems.push(`${label}: number touches its dot`);
        const outline = mins.querySelector("span");
        if (outline && mins.classList.contains("soon")) {
          const o = rect(outline), r = rect(row);
          if (o.top < r.top - 1 || o.bottom > r.bottom + 1) problems.push(`${label}: outline spills out of its row`);
          if (o.right > box.right + 1) problems.push(`${label}: outline clipped on the right`);
        }
        // The late badge overlaps the number's top-right corner on purpose; it must stay fully visible.
        const badge = row.querySelector(".late-badge");
        if (badge) {
          const b = rect(badge);
          if (b.right > box.right + 1 || b.top < box.top - 1) problems.push(`${label}: badge clipped`);
          if (b.left < rect(row.querySelector(".line-dot")).right) problems.push(`${label}: badge covers the dot`);
        }
      }
    }
    for (const head of document.querySelectorAll(".col-head")) {
      if (head.scrollWidth > head.clientWidth + 1) problems.push(`header "${head.textContent}" cut off`);
    }
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth || doc.scrollHeight > innerHeight) problems.push("page scrolls");
    return problems;
  });
}

// Per column: rows shown and number font size in px.
async function columnSummary(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".trains")].map(col => {
    const n = col.querySelector(".mins:not(.leaving)");
    return [col.id, {
      rows: col.querySelectorAll(".train").length,
      fontPx: n ? Math.round(parseFloat(getComputedStyle(n).fontSize)) : null,
      text: [...col.querySelectorAll(".mins > span")].map(s => s.textContent)
    }];
  })));
}

module.exports = { PAGE_URL, SCENARIOS, NO_ADVISORIES, ADVISORY, NOON, json, est, openBoard, layoutProblems, columnSummary,
  woofFixture, ESTUARY_MAP, noaaFixture, ORANGE, BLUE };
