// Runs the layout tests in Chromium (the same engine as the tablet's Android WebView).
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  timeout: 30 * 1000,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { browserName: "chromium", timezoneId: "America/Los_Angeles" }
});
