import fs from "fs";
import path from "path";

const files = [];

function addFile(relPath) {
  const full = path.resolve(relPath);
  if (!fs.existsSync(full)) return;
  const isBinary = /\.(png|jpg|jpeg|gif|ico|pdf|zip)$/i.test(relPath);
  const buf = fs.readFileSync(full);
  files.push({
    file: relPath.replace(/\\/g, "/"),
    data: isBinary ? buf.toString("base64") : buf.toString("utf-8"),
    encoding: isBinary ? "base64" : "utf-8"
  });
}

function addDir(dirRel) {
  const full = path.resolve(dirRel);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const childRel = path.join(dirRel, entry.name);
    if (entry.isDirectory()) {
      addDir(childRel);
    } else {
      // Don't include huge image files in inline deployment to keep it ultra fast
      if (entry.name.endsWith('.jpg') || entry.name.endsWith('.png')) {
        continue;
      }
      addFile(childRel);
    }
  }
}

addFile("package.json");
addFile("package-lock.json");
addFile("tsconfig.json");
addFile("vercel.json");
addFile("api/index.js");
addDir("src");
addDir("data");
addDir("public");

console.log("Adding inlined files count:", files.length);
const totalSize = files.reduce((acc, f) => acc + f.data.length, 0);
console.log("Total size (KB):", (totalSize / 1024).toFixed(1));

const payload = {
  name: "planpass",
  project: "prj_mCryxaJ7ye669OhtStfkU4zoccmz",
  target: "production",
  files
};

fs.writeFileSync("scripts/deploy-payload.json", JSON.stringify(payload));
console.log("Wrote scripts/deploy-payload.json successfully");
