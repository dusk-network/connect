/** Contract-call input already written as JSON; the contract facade hands it to the data-driver as is. */
export class JsonText {
  constructor(readonly text: string) {}
}

/** Write plain data as JSON, with each bigint as a bare integer, exactly at any size. */
export function jsonWithIntegers(value: unknown): JsonText {
  const write = (item: unknown): string =>
    typeof item === "bigint" ? item.toString()
      : Array.isArray(item) ? `[${item.map(write).join(",")}]`
        : item !== null && typeof item === "object"
          ? `{${Object.entries(item).filter(([, entry]) => entry !== undefined)
            .map(([key, entry]) => `${JSON.stringify(key)}:${write(entry)}`).join(",")}}`
          : JSON.stringify(item) ?? "null";
  return new JsonText(write(value));
}
