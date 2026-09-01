import { readFile } from "node:fs/promises";

const tag = process.argv[2];
if (!tag?.startsWith("v")) {
  throw new Error(`Expected a release tag like v1.0.0, received ${tag ?? "nothing"}`);
}

const expected = tag.slice(1);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const tauriConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = await readFile("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "package.json": packageJson.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
};

for (const [source, version] of Object.entries(versions)) {
  if (version !== expected) {
    throw new Error(`${source} has version ${version ?? "missing"}; release tag requires ${expected}`);
  }
}

console.log(`Release versions match ${tag}`);
