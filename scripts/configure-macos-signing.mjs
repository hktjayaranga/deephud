import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const keys = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
];
const configured = keys.filter((key) => process.env[key]?.trim());
const notarized = configured.length > 0;

if (notarized) {
  const missing = keys.filter((key) => !configured.includes(key));
  if (missing.length) {
    throw new Error(`Incomplete macOS signing secrets: missing ${missing.join(", ")}`);
  }
  if (!process.env.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application:")) {
    throw new Error("APPLE_SIGNING_IDENTITY must be a Developer ID Application identity");
  }
} else {
  console.log("::warning::No Apple signing secrets configured. macOS builds will be ad-hoc signed, not notarized, and may be blocked by Gatekeeper. See docs/RELEASING.md.");
}

// Do not forward empty Apple variables: Tauri treats their presence as configuration.
const values = notarized
  ? Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  : { APPLE_SIGNING_IDENTITY: "-" };
const exports = Object.entries(values).map(([key, value]) => {
  const delimiter = randomUUID();
  return `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
}).join("");
appendFileSync(process.env.GITHUB_ENV, exports);
appendFileSync(process.env.GITHUB_OUTPUT, `notarized=${notarized}\n`);
