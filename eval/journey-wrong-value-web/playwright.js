// A stub browser: page.goto really fetches the URL journey-gate served, and an element's value is
// read out of that HTML. web.sh's assertions are real; only Chromium is not.
let html = '';
const idOf = (sel) => (sel.match(/\[id="([^"]+)"\]/) || [])[1];
const loc = (sel) => ({
  first() { return this; }, async waitFor() {}, async click() {}, async fill() {}, async boundingBox() { return { width: 60, height: 60 }; },
  async innerText() { return html.replace(/<[^>]*>/g, ' '); },
  async evaluate() { const m = html.match(new RegExp(`id="${idOf(sel)}"[^>]*>([^<]*)`)); return m ? m[1].trim() : ''; },
});
exports.chromium = { async launch() { return { async newPage() { return {
  async goto(url) { html = await (await fetch(url)).text(); }, locator: loc, async goBack() {},
  async screenshot({ path }) { require('fs').writeFileSync(path, 'png'); } }; }, async close() {} }; } };
