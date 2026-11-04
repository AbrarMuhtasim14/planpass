// Focused unit checks for the SAM 3.1 special-token parser (src/meta.ts).
// Run after `npm run build`: node scripts/test-sam-parser.mjs
import { parseSamStream, normalizeConcepts } from "../dist/meta.js";
import { encodeSegmentationMask } from "../node_modules/@meta-sam/parser/dist/mask-codec.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

// Wire example from https://dev.meta.ai/docs/sam/reading-segmentation (video grammar, frame 0).
const payload1 = "~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";
const payload2 = "~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@";
const wire =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60," + payload1 + "|>" +
  ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,48," + payload2 + "|>";

const overlays = parseSamStream(wire, "door");
check("parses both records", overlays.length === 2, `count=${overlays.length}`);
check("keys overlays by wire object id", overlays[0]?.objectId === 0 && overlays[1]?.objectId === 1,
  `ids=${overlays.map((o) => o.objectId).join(",")}`);
// Boxes are source pixels scaled into the 1000x800 overlay space.
check("scales box into 1000x800 space",
  JSON.stringify(overlays[0]?.box_px) === JSON.stringify([659, 546, 844, 608]),
  `box=${JSON.stringify(overlays[0]?.box_px)}`);
// Docs-page payloads lose bytes to HTML encoding, so verify SVG decoding with a
// synthetic mask encoded by the official codec: 60x27 raster, filled block.
{
  const raster = new Uint8Array(60 * 27);
  for (let y = 5; y < 20; y++) for (let x = 10; x < 40; x++) raster[y * 60 + x] = 1;
  const mask = encodeSegmentationMask(raster, 60, 27);
  const enc = mask.encoding === "lossless" ? "~" : "!";
  const wireB = `<0f>3<|box;x1=100;y1=100;x2=220;y2=190;w=1000;h=800|><|mask;x=0;y=0;data=27,60,${enc}${mask.payload}|>`;
  const [o] = parseSamStream(wireB, "staircase");
  check("decodes mask to svg_path", typeof o?.svg_path === "string" && o.svg_path.startsWith("M"),
    `svg_path=${(o?.svg_path ?? "").slice(0, 24)}... len=${(o?.svg_path ?? "").length}`);
  check("synthetic box scales 1:1 at 1000x800", JSON.stringify(o?.box_px) === JSON.stringify([100, 100, 220, 190]),
    `box=${JSON.stringify(o?.box_px)}`);
}
check("carries mask raster size", overlays[0]?.mask_w === 60 && overlays[0]?.mask_h === 27,
  `mask=${overlays[0]?.mask_w}x${overlays[0]?.mask_h}`);
check("empty stream yields no overlays", parseSamStream("", "door").length === 0);
check("concepts are caller/agent supplied, normalized", JSON.stringify(normalizeConcepts("Door, staircase, door")) === JSON.stringify(["door", "staircase"]), normalizeConcepts("Door, staircase, door").join(","));

console.log(failures ? `\n${failures} parser check(s) FAILED` : "\nAll parser checks passed");
process.exit(failures ? 1 : 0);
