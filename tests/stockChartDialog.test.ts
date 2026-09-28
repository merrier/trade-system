// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StockChartProvider, StockLink, StockText } from "../web/src/StockChartDialog.js";

vi.mock("../web/src/StockKLineChart.js", () => ({ StockKLineChart: ({ code }: { code: string }) => React.createElement("div", { "data-chart-code": code }, code) }));

it("opens the selected stock only on demand, closes, restores focus and can open another stock", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(StockChartProvider, null,
      React.createElement(StockLink, { code: "600519", name: "贵州茅台" }),
      React.createElement(StockText, null, "平安银行 000001，日期 2026000519，金额 1234567"))));
    const links = container.querySelectorAll<HTMLButtonElement>(".stock-link");
    expect(links).toHaveLength(2);
    expect(container.querySelector("dialog")).toBeNull();
    links[0].focus();
    await act(async () => links[0].click());
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector("[data-chart-code]")?.getAttribute("data-chart-code")).toBe("600519");
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => container.querySelector<HTMLButtonElement>("dialog button")!.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(links[0]);
    expect(document.body.style.overflow).toBe("");
    await act(async () => links[1].click());
    expect(container.querySelector("[data-chart-code]")?.getAttribute("data-chart-code")).toBe("000001");
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel")));
    expect(container.querySelector("dialog")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
