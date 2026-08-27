import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const examples = [
  "drc20-demo",
  "drc721-demo",
  "l1standardbridge-demo",
  "systemconfig-demo",
];

describe("example styles", () => {
  it("resolves every local stylesheet reference", async () => {
    for (const example of examples) {
      const htmlPath = path.resolve("examples", example, "index.html");
      const html = await readFile(htmlPath, "utf8");
      const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]!);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        const cssPath = path.resolve(path.dirname(htmlPath), href);
        await expect(access(cssPath)).resolves.toBeUndefined();
        const css = await readFile(cssPath, "utf8");
        for (const match of css.matchAll(/@import\s+"([^"]+)"/g)) {
          await expect(access(path.resolve(path.dirname(cssPath), match[1]!))).resolves.toBeUndefined();
        }
      }
    }
  });
});
