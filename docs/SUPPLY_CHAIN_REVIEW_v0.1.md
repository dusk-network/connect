# Dusk Connect v0.1 Supply Chain Review

Reviewed: 2026-05-11  
Base: `origin/main` at `3797a2a`  
Verdict: **GO**

This review inspected the current lockfile, clean build, and npm package contents without upgrading dependencies. Connect has no runtime `dependencies`; the published package is made from first-party `dist` output plus `README.md`, `LICENSE`, and `package.json`. No `node_modules` code is bundled into `dist`.

## Commands Run

- `npm ci`
- `npm run build`
- `npm run ci`
- `npm pack --dry-run`
- `npm pack --dry-run --json`
- `npm audit --json`
- source-map package inventory across `dist/**/*.js.map`
- artifact scans across `dist/**/*.js` for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `mnemonic`, `privateKey`, `seed`, `password`, `vault`, `recovery`, `secret`, `eval`, `new Function`, `Function(`, `import(`, `http://`, `https://`, `script.src`, `getURL`, and `.wasm`

Result: install, build, CI, and pack dry-run passed. `npm audit --json` reported 0 vulnerabilities.

## Dependency Surface

Runtime dependencies:

- None. `package.json` has no `dependencies`.

Dev/build/test dependencies:

- `typescript@5.9.3`
- `vitest@4.1.4`
- `@vitest/coverage-v8@4.1.4`
- `jsdom@29.0.2`

Build/test transitive native/binary packages installed on this platform:

- `rolldown@1.0.0-rc.15`
- `@rolldown/binding-linux-x64-gnu@1.0.0-rc.15`
- `@rolldown/binding-linux-x64-musl@1.0.0-rc.15`
- `lightningcss@1.32.0`
- `lightningcss-linux-x64-gnu@1.32.0`
- `lightningcss-linux-x64-musl@1.32.0`

Package bins present include `tsc`, `tsserver`, `vitest`, `vite`, `rolldown`, `semver`, `nanoid`, `tldts`, and parser/helper CLIs. These are install/build/test-time tools, not packed runtime dependencies.

Lifecycle script metadata found in installed packages includes `prepare`/`prepack` entries on packages such as `jsdom`, `undici`, `lightningcss`, `lru-cache`, `tldts`, `tough-cookie`, `istanbul-reports`, and `tinyexec`. No installed package exposed an install-time `preinstall`, `install`, or `postinstall` script in this review.

## Packed Package Contents

`npm pack --dry-run --json` reported:

- Package: `@dusk-network/connect@0.0.1`
- Tarball: `dusk-network-connect-0.0.1.tgz`
- Size: 85.7 kB
- Unpacked size: 382.6 kB
- Entries: 103
- Bundled dependencies: none

Packed files are limited to:

- `LICENSE`
- `README.md`
- `package.json`
- `dist/**/*.js`
- `dist/**/*.js.map`
- `dist/**/*.d.ts`
- `dist/**/*.d.ts.map`

This matches the expected SDK package surface. The v0.1 release PR still needs the package version bump from `0.0.1` to `0.1.0`.

## Artifact Inspection

Source-map inventory found no `node_modules` sources in `dist/**/*.js.map`.

Network/dynamic-code scan:

| File | Findings | Assessment |
| --- | --- | --- |
| `dist/app.js` | `fetch` references through data-driver loading; Dusk fallback URLs in comments/default config | Expected SDK behavior for configured node/data-driver usage. |
| `dist/driver.js` | `fetchWasmDataDriver(url, opts)` uses `opts.fetch ?? fetch` | Expected helper; caller-supplied URL and fetch are explicit API surface. |
| `dist/node.js` | `fetch` and `WebSocket` helpers | Expected node RPC and transaction wait behavior. |
| `dist/standards/drc20.js`, `dist/standards/drc721.js` | Optional `fetchWasmDataDriver(opts.driverUrl)` | Expected explicit data-driver URL behavior. |
| `dist/ui/modal.js` | Static SVG/data content match only | No runtime network call from this hit. |

No generated Connect artifact contained `XMLHttpRequest`, `sendBeacon`, `EventSource`, `eval`, `new Function`, or dynamic `import(`. No secret-term hits were found in `dist/**/*.js`.

## Risk Table

| Package/name | Direct/transitive | Runtime/build/test | Bundled into package? | Lifecycle scripts? | Network/file/process capability? | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@dusk-network/connect` first-party `dist` | First-party | Runtime package | Yes | `prepack` runs local build | SDK exposes provider, node fetch, WebSocket, and data-driver helpers by design | Low-medium | Ship after final version bump and pack validation. |
| Runtime dependencies | N/A | Runtime | None | N/A | N/A | Low | Keep `dependencies` empty for v0.1 unless there is a strong reason. |
| `typescript@5.9.3` | Direct | Build | No | Bin only | Compiler reads source and writes `dist` | Low-medium | Accept; keep lockfile pinned. |
| `vitest@4.1.4`, `@vitest/coverage-v8@4.1.4` | Direct | Test | No | Bin/test tooling | Test runner executes repo tests | Low-medium | Accept; do not run release secrets in untrusted test contexts. |
| `jsdom@29.0.2` | Direct | Test | No | `prepare` metadata | Test DOM emulation; transitive `undici` can provide fetch-like APIs in tests | Low | Accept; not packed runtime. |
| `vite@8.0.8`, `rolldown@1.0.0-rc.15` | Transitive build/test | Build/test | No | Bins; native bindings installed transitively | Build/test transform path | Medium release-integrity | Keep lockfile pinned; review generated `dist` before publish. |
| `@rolldown/binding-linux-x64-*` | Transitive | Build/test native | No | Native `.node` packages | Native build binding | Medium release-integrity | Accept for current build; verify CI platform and lockfile. |
| `lightningcss@1.32.0`, `lightningcss-linux-x64-*` | Transitive | Build/test native | No | `prepare` metadata; native `.node` packages | CSS transform path if invoked by tooling | Low-medium | Accept; not packed runtime. |
| `undici@7.25.0` | Transitive test | Test | No | `prepare` metadata | HTTP client implementation in test dependency graph | Low | Accept; no Connect runtime bundle inclusion. |
| `lru-cache@11.3.5`, `tldts@7.0.28`, `tough-cookie@6.0.1` | Transitive test | Test | No | `prepare`/`prepack` metadata | Test dependency graph only | Low | Accept. |

## Release Recommendations

- Keep Connect runtime dependency-free for v0.1.
- Continue validating `npm pack --dry-run` in the final release PR.
- Bump `@dusk-network/connect` from `0.0.1` to `0.1.0` in the final release PR, not in this supply-chain review.
- Do not add bundled runtime dependencies without updating this review and inspecting `dist/**/*.js.map`.
- Current v0.1 posture is GO: no dependency upgrade is required by this pass.
