import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

describe("package scaffold", () => {
  test("prepack builds the exported dist files", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts.prepack).toBe("bun run build");
    expect(packageJson.exports["."].import).toBe("./dist/index.js");
    expect(packageJson.exports["./syntax"].import).toBe("./dist/syntax.js");
    expect(packageJson.exports["./browser"].import).toBe("./dist/browser.js");
  });

  test("published files include only source-owned dist artifacts", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.files).toEqual([
      "dist",
      "README.md",
      "LICENSE",
      "NOTICE",
      "CHANGELOG.md",
      "SECURITY.md",
    ]);
    expect(Object.keys(packageJson.exports)).toEqual([
      ".",
      "./syntax",
      "./browser",
      "./package.json",
    ]);
    for (const exportSpec of Object.values(packageJson.exports)) {
      if (typeof exportSpec === "string") continue;
      expect(exportSpec).toMatchObject({
        import: expect.stringMatching(/^\.\/dist\/.+\.js$/),
        types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/),
      });
    }
  });

  test("published documentation and notices exist", () => {
    expect(existsSync("README.md")).toBe(true);
    expect(existsSync("LICENSE")).toBe(true);
    expect(existsSync("NOTICE")).toBe(true);
    expect(existsSync("CHANGELOG.md")).toBe(true);
    expect(existsSync("SECURITY.md")).toBe(true);
  });

  test("browser bundle stays free of Node built-ins", async () => {
    if (!existsSync("dist/browser.js")) return;

    const browserJs = await readFile("dist/browser.js", "utf8");
    expect(browserJs).not.toContain("node:");
    expect(browserJs).not.toContain("dns/promises");
    expect(browserJs).not.toContain("node:net");
    expect(browserJs).not.toContain("node:tls");
  });

  test("built package exports include current public API", async () => {
    if (!existsSync("dist/index.js")) return;

    const packageEntry = "../dist/index.js";
    const pkg = await import(packageEntry);
    const types = await readFile("dist/types.d.ts", "utf8");
    const smtp = await readFile("dist/smtp.js", "utf8");

    expect(typeof pkg.validateEmail).toBe("function");
    expect(typeof pkg.probeSmtp).toBe("function");
    expect(types).toContain("detectCatchAll");
    expect(types).toContain("catchAllAddressFactory");
    expect(smtp).toContain("catch_all");
  });
});
