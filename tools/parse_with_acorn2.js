const fs = require("fs");
const acorn = require("acorn");
const s = fs.readFileSync("Index.html", "utf8");
let idx = 0,
  count = -1,
  start = -1,
  end = -1;
while (true) {
  const sidx = s.indexOf("<script", idx);
  if (sidx === -1) break;
  const gt = s.indexOf(">", sidx);
  if (gt === -1) break;
  start = gt + 1;
  end = s.indexOf("</script>", start);
  if (end === -1) break;
  count++;
  if (count === 12) break;
  idx = end + 9;
}
const inner = s.substring(start, end);
try {
  acorn.parse(inner, { ecmaVersion: 2024, locations: true });
  console.log("parsed ok");
} catch (e) {
  console.error("Acorn error:", e.message);
  if (e.loc) console.error("line", e.loc.line, "column", e.loc.column);
  // print surrounding lines
  const lines = inner.split("\n");
  const L = e.loc ? e.loc.line : Math.max(1, Math.floor(inner.length / 1000));
  const startL = Math.max(1, L - 6);
  const endL = Math.min(lines.length, L + 6);
  console.error(lines.slice(startL - 1, endL).join("\n"));
}
