#!/usr/bin/env node
// Fetches the WOOF forecast (https://woof.recastsystems.com/docs/point) for the
// rowing course and writes data/estuary-wind.json, which the kiosk page reads.
// The page can't call WOOF itself: WOOF doesn't allow requests from web pages.
//
// Run by .github/workflows/estuary-wind.yml every hour. WOOF starts a new 48-hour
// forecast twice a day, so the file only changes (and is only committed) a few
// times a day. Needs Node 20+ and nothing else:  node .github/scripts/fetch-estuary-wind.mjs
import { readFile, writeFile } from "node:fs/promises";

const API = "https://woof.recastsystems.com/api/v1/forecast";
const MAP_FILE = new URL("../../data/estuary-map.json", import.meta.url);
const OUT_FILE = new URL("../../data/estuary-wind.json", import.meta.url);
const TIME_ZONE = "America/Los_Angeles";
const WIND_HOURS = { from: 5, until: 10 };   // keep wind along the course for 5 AM - 10 AM (covers practice)
const POINTS_PER_CALL = 10;                  // WOOF's limit
const PAUSE_MS = 1100;                       // WOOF allows 60 calls a minute without a key

const sleep = ms => new Promise(r => setTimeout(r, ms));
const localHour = s => Number(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(new Date(s * 1000))) % 24;
const round = (v, digits) => v === null || v === undefined ? null : Number(v.toFixed(digits));

// One WOOF call for up to 10 points. Returns a list with one forecast per point.
async function woof(points, hourly) {
  const url = `${API}?latitude=${points.map(p => p.lat).join(",")}&longitude=${points.map(p => p.lon).join(",")}` +
    `&hourly=${hourly}&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timeformat=unixtime&timezone=GMT`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "estuary-wind-fetch" }, signal: AbortSignal.timeout(40000) }).catch(err => ({ ok: false, status: 0, err }));
    if (res.ok) {
      const body = await res.json();
      return Array.isArray(body) ? body : [body];
    }
    if (attempt >= 4) throw new Error(`WOOF request failed (${res.status || res.err})`);
    const retryAfter = res.headers ? Number(res.headers.get("retry-after")) : 0;
    await sleep(retryAfter ? retryAfter * 1000 : attempt * 5000);
  }
}

async function fetchAll(map) {
  const boathouse = map.landmarks.find(l => l.name === "Boathouse");
  const [home] = await woof([boathouse], "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,visibility,cloud_cover_low");
  const forecasts = [];
  for (let i = 0; i < map.points.length; i += POINTS_PER_CALL) {
    await sleep(PAUSE_MS);
    forecasts.push(...await woof(map.points.slice(i, i + POINTS_PER_CALL), "wind_speed_10m,wind_direction_10m,wind_gusts_10m"));
  }
  return { home, forecasts };
}

function build(map, { home, forecasts }) {
  const h = home.hourly;
  const out = {
    source: "WOOF, Recast",
    forecast: home.woof.forecast,
    run: home.woof.run,
    init: home.woof.init,
    points: map.points.length,
    // Hourly at the boathouse for the whole forecast. rainIn is the total over the hour before each time.
    boathouse: {
      time: h.time,
      tempF: h.temperature_2m.map(v => round(v, 0)),
      windMph: h.wind_speed_10m.map(v => round(v, 1)),
      windFromDeg: h.wind_direction_10m.map(v => round(v, 0)),
      gustMph: h.wind_gusts_10m.map(v => round(v, 0)),
      rainIn: h.precipitation.map(v => round(v, 2)),
      visibilityMi: h.visibility.map(v => v === null ? null : round(v / 1609.344, 1)),
      lowCloudPct: h.cloud_cover_low.map(v => round(v, 0))
    },
    // Wind at every map point (same order as "points" in estuary-map.json), for the morning hours only.
    wind: []
  };
  const times = forecasts[0].hourly.time;
  times.forEach((time, i) => {
    const hour = localHour(time);
    if (hour < WIND_HOURS.from || hour > WIND_HOURS.until) return;
    const at = key => forecasts.map(f => f.hourly[key][i]);
    const speed = at("wind_speed_10m"), from = at("wind_direction_10m"), gust = at("wind_gusts_10m");
    if ([...speed, ...from, ...gust].some(v => v === null || v === undefined)) return;   // forecast still running: hour not ready
    out.wind.push({ time, speedMph: speed.map(v => round(v, 1)), fromDeg: from.map(v => round(v, 0)), gustMph: gust.map(v => round(v, 0)) });
  });
  return out;
}

const map = JSON.parse(await readFile(MAP_FILE, "utf8"));
let data = await fetchAll(map);
const runs = d => new Set([d.home, ...d.forecasts].map(f => f.woof.run));
if (runs(data).size > 1) {   // WOOF switched to a new forecast part-way through: start over once
  console.log("Forecast changed during the fetch; fetching again.");
  await sleep(5000);
  data = await fetchAll(map);
  if (runs(data).size > 1) throw new Error("Forecast kept changing during the fetch; try again later.");
}
const next = build(map, data);

let previous = null;
try { previous = JSON.parse(await readFile(OUT_FILE, "utf8")); } catch { /* first run */ }

// A forecast that has just started may not have reached tomorrow morning yet.
// Keep the older file while it still covers upcoming hours that the new one lacks.
const now = Date.now() / 1000;
const upcoming = d => d.wind.map(w => w.time).filter(t => t > now && t < now + 30 * 3600);
if (previous && previous.points === next.points && upcoming(previous).some(t => !upcoming(next).includes(t))) {
  console.log(`Forecast ${next.run} doesn't cover all upcoming mornings yet; keeping ${previous.run}.`);
} else if (!next.wind.length) {
  throw new Error("WOOF returned no complete morning hours.");
} else {
  await writeFile(OUT_FILE, JSON.stringify(next).replace(/("wind":\[|\},)(\{"time")/g, "$1\n$2") + "\n");
  console.log(`Wrote forecast ${next.run} (started ${next.init}): ${next.wind.length} morning hours, ${next.points} points.`);
}
