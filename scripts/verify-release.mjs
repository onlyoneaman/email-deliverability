#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = new Set(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const sizeLimit = Number.parseInt(process.env.PACKAGE_SIZE_LIMIT_BYTES ?? "102400", 10);

if (args.has("--help")) {
  console.log(`Usage: node scripts/verify-release.mjs [--published]

Runs build, tests, typecheck, dataset verification, npm pack allowlist checks,
and package-size enforcement. Add --published to also verify the current
package.json version exists on npm.`);
  process.exit(0);
}

for (const arg of args) {
  if (arg !== "--published") {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout}${result.stderr}` : "";
    throw new Error(`Command failed: ${command} ${commandArgs.join(" ")}${details}`);
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyPackageMetadata() {
  assert(packageJson.name === "email-deliverability", "Unexpected package name");
  assert(packageJson.type === "module", "Package must stay ESM");
  assert(packageJson.sideEffects === false, "Package must stay side-effect free");
  assert(packageJson.exports?.["."]?.import === "./dist/index.js", "Main export must point at dist/index.js");
  assert(packageJson.exports?.["./syntax"]?.import === "./dist/syntax.js", "Syntax export must exist");
  assert(packageJson.exports?.["./browser"]?.import === "./dist/browser.js", "Browser export must exist");
  assert(packageJson.files.includes("dist"), "Published files must include dist");
  assert(!packageJson.files.includes("src"), "Do not publish src by default");
  assert(!packageJson.files.includes("tests"), "Do not publish tests");
}

function verifyPack() {
  const output = run("npm", ["pack", "--dry-run", "--json"], { capture: true });
  const [pack] = JSON.parse(output);
  assert(pack.name === packageJson.name, "Packed package name mismatch");
  assert(pack.version === packageJson.version, "Packed package version mismatch");
  assert(pack.size <= sizeLimit, `Package too large: ${pack.size} bytes > ${sizeLimit} bytes`);

  const files = pack.files.map((file) => file.path);
  assert(files.includes("dist/index.js"), "Packed package missing dist/index.js");
  assert(files.includes("dist/index.d.ts"), "Packed package missing dist/index.d.ts");
  assert(files.includes("dist/browser.js"), "Packed package missing dist/browser.js");
  assert(files.includes("dist/syntax.js"), "Packed package missing dist/syntax.js");
  assert(files.includes("README.md"), "Packed package missing README.md");
  assert(files.includes("LICENSE"), "Packed package missing LICENSE");
  assert(files.includes("NOTICE"), "Packed package missing NOTICE");
  assert(files.every((file) => !file.startsWith("src/")), "Packed package must not include src/");
  assert(files.every((file) => !file.startsWith("tests/")), "Packed package must not include tests/");
  assert(files.every((file) => !file.startsWith("scripts/")), "Packed package must not include scripts/");
  assert(files.every((file) => !file.startsWith("docs/")), "Packed package must not include docs/");
  assert(!files.includes("AGENTS.md"), "Packed package must not include AGENTS.md");

  console.log(`Pack verification passed: size=${pack.size}, unpacked=${pack.unpackedSize}, files=${pack.entryCount}`);
}

function verifyPublished() {
  const spec = `${packageJson.name}@${packageJson.version}`;
  const output = run("npm", ["view", spec, "name", "version", "dist.tarball", "repository.url", "--json"], {
    capture: true,
  });
  const view = JSON.parse(output);
  assert(view.name === packageJson.name, `Published package not found for ${spec}`);
  assert(view.version === packageJson.version, `Published version mismatch for ${spec}`);
  assert(
    view["dist.tarball"]?.includes(`${packageJson.name}-${packageJson.version}.tgz`),
    "Published tarball URL does not match package/version",
  );
  console.log(`Published verification passed: ${spec}`);
}

verifyPackageMetadata();
run("bun", ["run", "build"]);
run("bun", ["test"]);
run("bun", ["run", "typecheck"]);
run("bun", ["run", "datasets:verify"]);
verifyPack();

if (args.has("--published")) verifyPublished();

console.log(`Release verification passed for ${packageJson.name}@${packageJson.version}`);
