import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const packagePath = lockPath.slice(lockPath.lastIndexOf(marker) + marker.length);
  const parts = packagePath.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

const approved = packageJson.allowScripts ?? {};
const discovered = Object.entries(packageLock.packages ?? {})
  .filter(([, metadata]) => metadata.hasInstallScript === true)
  .map(([lockPath, metadata]) => {
    const name = packageNameFromLockPath(lockPath);
    return `${name}@${metadata.version}`;
  })
  .sort();

const unreviewed = discovered.filter((specifier) => approved[specifier] !== true);
const stale = Object.keys(approved)
  .filter((specifier) => approved[specifier] === true && !discovered.includes(specifier))
  .sort();

if (unreviewed.length > 0 || stale.length > 0) {
  if (unreviewed.length > 0) {
    console.error(`Unreviewed dependency install scripts: ${unreviewed.join(", ")}`);
  }
  if (stale.length > 0) {
    console.error(`Stale install-script approvals: ${stale.join(", ")}`);
  }
  console.error(
    "Review each package and keep package.json allowScripts synchronized with exact locked versions.",
  );
  process.exit(1);
}

console.log(`Reviewed dependency install scripts: ${discovered.join(", ")}`);
