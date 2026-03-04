const fs = require("fs");
const s = fs.readFileSync("Index.html", "utf8");
let idx = 0,
  count = -1;
let ok = true;
while (true) {
  const sidx = s.indexOf("<script", idx);
  if (sidx === -1) break;
  const gt = s.indexOf(">", sidx);
  if (gt === -1) break;
  const start = gt + 1;
  const end = s.indexOf("</script>", start);
  if (end === -1) break;
  count++;
  const inner = s.substring(start, end);
  try {
    new Function(inner);
    console.log("script", count, "parsed ok");
  } catch (e) {
    console.error("script", count, "ERR", e.name + ":", e.message);
    const startLine = s.substring(0, start).split("\n").length;
    const endLine = s.substring(0, end).split("\n").length;
    console.error("script lines", startLine + "-" + endLine);
    ok = false;
    break;
  }
  idx = end + 9;
}
if (ok) console.log("all scripts parsed");
else process.exit(1);
