import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DUSK_ANNOUNCE_PROVIDER_EVENT,
  DUSK_PROVIDER_INFO_FIELDS,
  DUSK_REQUEST_PROVIDER_EVENT,
} from "./discovery.js";

function uniqSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function extractSectionBacktickedBullets(markdown: string, sectionTitle: string): string[] {
  const lines = String(markdown).split(/\r?\n/);
  const out = [];
  let inSection = false;

  for (const line of lines) {
    if (line === `## ${sectionTitle}`) {
      inSection = true;
      continue;
    }

    if (inSection && /^##\s+/.test(line)) {
      break;
    }

    if (!inSection) continue;

    const match = line.match(/^\s*-\s+`([^`]+)`\s*$/);
    if (match) out.push(match[1]);
  }

  return out;
}

describe("Discovery Conformance", () => {
  it("docs/wallet-discovery.md matches exported discovery events and info fields", async () => {
    const docPath = path.resolve(process.cwd(), "docs", "wallet-discovery.md");
    const md = await readFile(docPath, "utf8");

    expect(uniqSorted(extractSectionBacktickedBullets(md, "Events"))).toEqual(
      uniqSorted([DUSK_REQUEST_PROVIDER_EVENT, DUSK_ANNOUNCE_PROVIDER_EVENT])
    );

    expect(uniqSorted(extractSectionBacktickedBullets(md, "Wallet Metadata"))).toEqual(
      uniqSorted([...DUSK_PROVIDER_INFO_FIELDS])
    );
  });

  it("README discovery section mentions the canonical discovery events", async () => {
    const readmePath = path.resolve(process.cwd(), "README.md");
    const md = await readFile(readmePath, "utf8");

    expect(md.includes(`\`${DUSK_REQUEST_PROVIDER_EVENT}\``)).toBe(true);
    expect(md.includes(`\`${DUSK_ANNOUNCE_PROVIDER_EVENT}\``)).toBe(true);
  });
});
