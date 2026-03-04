const fs = require("fs");
const s = fs.readFileSync("Index.html", "utf8");
// find script #12
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
if (start === -1) {
  console.error("script not found");
  process.exit(1);
}
const inner = s.substring(start, end);
let lo = 0,
  hi = inner.length,
  failAt = -1;
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2);
  const piece = inner.substring(0, mid);
  try {
    new Function(piece);
    lo = mid + 1;
  } catch (e) {
    if (e && e.name === "SyntaxError") {
      failAt = mid;
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
}
if (failAt === -1) {
  console.log("could not locate failure");
  process.exit(0);
}
const ctxStart = Math.max(0, failAt - 200);
const ctxEnd = Math.min(inner.length, failAt + 200);
const ctx = inner.substring(ctxStart, ctxEnd);
const startLine = s.substring(0, start).split("\n").length;
const fileCharOffset = start + ctxStart;
const fileLine = s.substring(0, fileCharOffset).split("\n").length;
console.log("failAt index in script:", failAt);
console.log("approx file line:", fileLine);
console.log("--- context ---");
console.log(ctx);
fs.writeFileSync(
  "tools/regex_error_context.txt",
  `failAt:${failAt}\nfileLine:${fileLine}\n---ctx---\n${ctx}`,
);
console.log("wrote tools/regex_error_context.txt");
