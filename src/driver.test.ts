import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWasmDataDriver, loadWasmDataDriver } from "./driver.js";

function createInstantiateResult() {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const memory = new WebAssembly.Memory({ initial: 8 });
  let allocPtr = 1024;
  let lastError = "";

  const readString = (ptr: number, len: number) =>
    dec.decode(new Uint8Array(memory.buffer, ptr, len));

  const writeOut = (outPtr: number, bytes: Uint8Array) => {
    new DataView(memory.buffer, outPtr, 4).setUint32(0, bytes.length, true);
    new Uint8Array(memory.buffer, outPtr + 4, bytes.length).set(bytes);
    return 0;
  };

  const writeJson = (outPtr: number, value: unknown) =>
    writeOut(outPtr, enc.encode(JSON.stringify(value)));

  return {
    exports: {
      memory,
      alloc: (len: number) => {
        const ptr = allocPtr;
        allocPtr += Math.max(len + 16, 32);
        return ptr;
      },
      dealloc: vi.fn(),
      get_last_error: (outPtr: number) => writeOut(outPtr, enc.encode(lastError)),
      encode_input_fn: (
        fnPtr: number,
        fnLen: number,
        jsonPtr: number,
        jsonLen: number,
        outPtr: number
      ) => writeOut(outPtr, enc.encode(`${readString(fnPtr, fnLen)}:${readString(jsonPtr, jsonLen)}`)),
      decode_input_fn: (
        fnPtr: number,
        fnLen: number,
        rkyvPtr: number,
        rkyvLen: number,
        outPtr: number
      ) =>
        writeJson(outPtr, {
          kind: "input",
          fnName: readString(fnPtr, fnLen),
          payload: readString(rkyvPtr, rkyvLen),
        }),
      decode_output_fn: (
        fnPtr: number,
        fnLen: number,
        rkyvPtr: number,
        rkyvLen: number,
        outPtr: number
      ) =>
        writeJson(outPtr, {
          kind: "output",
          fnName: readString(fnPtr, fnLen),
          payload: readString(rkyvPtr, rkyvLen),
        }),
      decode_event: (
        evPtr: number,
        evLen: number,
        rkyvPtr: number,
        rkyvLen: number,
        outPtr: number
      ) =>
        writeJson(outPtr, {
          kind: "event",
          eventName: readString(evPtr, evLen),
          payload: readString(rkyvPtr, rkyvLen),
        }),
      get_schema: (outPtr: number) => writeJson(outPtr, { methods: ["ping"] }),
      get_version: (outPtr: number) => writeOut(outPtr, enc.encode("1.0.0")),
      init: vi.fn(() => 1),
    },
    setLastError(next: string) {
      lastError = next;
    },
  };
}

describe("driver loader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a mocked wasm data-driver and exposes working JS bindings", async () => {
    const instance = createInstantiateResult();
    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      instance: { exports: instance.exports },
    } as any);

    const driver = await loadWasmDataDriver(new Uint8Array([0, 1, 2, 3]));

    expect(new TextDecoder().decode(driver.encodeInputFn("ping", "{\"ok\":true}"))).toBe(
      "ping:{\"ok\":true}"
    );
    expect(driver.decodeInputFn("ping", new TextEncoder().encode("hello"))).toEqual({
      kind: "input",
      fnName: "ping",
      payload: "hello",
    });
    expect(driver.decodeOutputFn("pong", new TextEncoder().encode("world"))).toEqual({
      kind: "output",
      fnName: "pong",
      payload: "world",
    });
    expect(driver.decodeEvent("Executed", new TextEncoder().encode("done"))).toEqual({
      kind: "event",
      eventName: "Executed",
      payload: "done",
    });
    expect(driver.getSchema()).toEqual({ methods: ["ping"] });
    expect(driver.getVersion()).toBe("1.0.0");
    expect(driver.init?.()).toBe(1);
  });

  it("fetches wasm bytes, initializes the driver, and surfaces fetch failures", async () => {
    const instance = createInstantiateResult();
    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      instance: { exports: instance.exports },
    } as any);

    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const driver = await fetchWasmDataDriver("/driver.wasm", {
      fetch: fetchMock as any,
      init: { cache: "no-store" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/driver.wasm", { cache: "no-store" });
    expect(instance.exports.init).toHaveBeenCalledTimes(1);
    expect(driver.getVersion()).toBe("1.0.0");

    const badFetch = vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" }));
    await expect(fetchWasmDataDriver("/missing.wasm", { fetch: badFetch as any })).rejects.toThrow(
      /404 Not Found/
    );
  });
});
