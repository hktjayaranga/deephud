import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function configure(secrets = {}) {
  const directory = mkdtempSync(join(tmpdir(), "deephud-signing-"));
  directories.push(directory);
  const envFile = join(directory, "env");
  const outputFile = join(directory, "output");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("APPLE_")));
  const result = spawnSync(process.execPath, ["scripts/configure-macos-signing.mjs"], {
    env: { ...env, ...secrets, GITHUB_ENV: envFile, GITHUB_OUTPUT: outputFile },
    encoding: "utf8",
  });
  const read = (path) => {
    try { return readFileSync(path, "utf8"); } catch { return ""; }
  };
  return { ...result, exported: read(envFile), output: read(outputFile) };
}

const credentials = {
  APPLE_CERTIFICATE: "fake-certificate-line-1\nfake-certificate-line-2",
  APPLE_CERTIFICATE_PASSWORD: "fake-export-password",
  APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (TEAM)",
  APPLE_ID: "test@example.invalid",
  APPLE_PASSWORD: "fake-app-password",
  APPLE_TEAM_ID: "TEAM",
};

describe("macOS release signing configuration", () => {
  it("keeps absent Apple credentials undefined for ad-hoc builds", () => {
    const result = configure({ APPLE_CERTIFICATE: "", APPLE_ID: "" });
    expect(result.status).toBe(0);
    expect(result.exported).toMatch(/^APPLE_SIGNING_IDENTITY<<[^\n]+\n-\n[^\n]+\n$/);
    expect(result.output).toBe("notarized=false\n");
    expect(result.stdout).toContain("::warning::");
  });

  it("forwards complete credentials without printing their values", () => {
    const result = configure(credentials);
    expect(result.status).toBe(0);
    expect(result.output).toBe("notarized=true\n");
    for (const [key, value] of Object.entries(credentials)) {
      expect(result.exported).toContain(`${key}<<`);
      expect(result.exported).toContain(`\n${value}\n`);
      expect(result.stdout + result.stderr).not.toContain(value);
    }
  });

  it.each(Object.keys(credentials))("rejects a missing %s before exporting anything", (key) => {
    const result = configure({ ...credentials, [key]: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`missing ${key}`);
    expect(result.exported).toBe("");
    expect(result.output).toBe("");
  });

  it.each(["-", "Apple Development: Test (TEAM)"])("rejects identity %s for a notarized release", (identity) => {
    const result = configure({ ...credentials, APPLE_SIGNING_IDENTITY: identity });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be a Developer ID Application identity");
    expect(result.exported).toBe("");
  });
});
