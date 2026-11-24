import { afterEach, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: execute }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetModules(); execute.mockClear(); });

it.each([
  ["2026-11-24T14:50:00+08:00", "20261123"],
  ["2026-11-24T16:40:00+08:00", "20261124"]
])("uses only completed sessions at %s", async (time, cutoff) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(time));
  await import("../src/jobs/ingestAShareDaily.js");
  const args = execute.mock.calls[0][1] as string[];
  const dates = args[args.indexOf("--dates") + 1].split(",");
  expect(dates).toHaveLength(30);
  expect(dates.at(-1)).toBe(cutoff);
});

it("exits before any collection on a non-trading day", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-22T16:40:00+08:00"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../src/jobs/ingestAShareDaily.js");
  expect(execute).not.toHaveBeenCalled();
});
