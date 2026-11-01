// Shared helpers for the layout tests: fake BART data, opening the board, and
// a geometry check that reports anything clipped, overlapping or cut off.
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

function json(body, status = 200) {
  return { status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) };
}

// Opens the board with fake BART responses. `departures` may be a function
// (called per request) to change the data or fail between refreshes.
async function openBoard(page, { etd = SCENARIOS.normal, bsa = NO_ADVISORIES, query = "", departures } = {}) {
  await page.route("https://api.bart.gov/api/etd.aspx**", route =>
    route.fulfill(departures ? departures() : json({ root: { station: [{ etd }] } })));
  await page.route("https://api.bart.gov/api/bsa.aspx**", route => route.fulfill(json(bsa)));
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
        const own = rect(mins), text = textRect(mins);
        if (text.right > box.right + 1) problems.push(`${label}: number clipped on the right`);
        if (text.right > own.right + 1 || text.left < own.left - 1) problems.push(`${label}: number spills out of its outline`);
        if (text.left < rect(row.querySelector(".line-dot")).right + 1) problems.push(`${label}: number touches its dot`);
        const badge = row.querySelector(".late-badge");
        if (badge) {
          const b = rect(badge);
          if (b.left < Math.max(own.right, text.right) + 1) problems.push(`${label}: badge touches the number`);
          if (b.right > box.right + 1) problems.push(`${label}: badge clipped`);
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
      text: [...col.querySelectorAll(".train")].map(r => r.textContent)
    }];
  })));
}

module.exports = { PAGE_URL, SCENARIOS, NO_ADVISORIES, ADVISORY, json, est, openBoard, layoutProblems, columnSummary, ORANGE, BLUE };
