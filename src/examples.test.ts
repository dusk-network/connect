import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("example styles", () => {
  it("resolves every local stylesheet reference", async () => {
    for (const example of await readdir("examples", { withFileTypes: true })) {
      if (!example.isDirectory()) continue;
      const htmlPath = path.resolve("examples", example.name, "index.html");
      const html = await readFile(htmlPath, "utf8");
      const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]!);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        const cssPath = path.resolve(path.dirname(htmlPath), href);
        const css = await readFile(cssPath, "utf8");
        for (const match of css.matchAll(/@import\s+"([^"]+)"/g)) {
          await expect(access(path.resolve(path.dirname(cssPath), match[1]!))).resolves.toBeUndefined();
        }
      }
    }
  });
});
