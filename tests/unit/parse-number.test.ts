import { describe, expect, it } from "vitest";
import { normalizeNumber } from "@/lib/parse-number";

describe("números escritos como en Colombia", () => {
  it.each([
    ["1.599.000", "1599000"],
    ["1.500", "1500"],
    ["$ 25.000", "25000"],
    ["1.599.000,50", "1599000.50"],
    ["1,599,000.50", "1599000.50"],
    ["1,5", "1.5"],
    ["2.5", "2.5"],
    ["0,25", "0.25"],
    ["10", "10"],
    [" 007 ", "7"],
    [12.75, "12.75"],
    ["-3", "-3"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeNumber(input)).toBe(expected);
  });

  it.each(["", "abc", "1.2.3,4,5", "1,,2", "--1", "1e5"])("rechaza %s", (input) => {
    expect(normalizeNumber(input)).toBeNull();
  });
});
