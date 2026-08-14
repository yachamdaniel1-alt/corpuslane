import { parseTerms } from "../services/indexer";

describe("parseTerms (LicenseTerms enum decoding)", () => {
  it("decodes the array form scValToNative produces", () => {
    expect(parseTerms(["PerQuery", "5"])).toEqual({ type: "PerQuery", price: "5" });
    expect(parseTerms(["Flat", "100"])).toEqual({ type: "Flat", price: "100" });
  });

  it("decodes PerEpoch arrays with epoch seconds", () => {
    expect(parseTerms(["PerEpoch", ["10", 100]])).toEqual({
      type: "PerEpoch",
      price: "10",
      epochSeconds: 100,
    });
    expect(parseTerms(["PerEpoch", ["10", "3600"]])).toEqual({
      type: "PerEpoch",
      price: "10",
      epochSeconds: 3600,
    });
  });

  it("decodes the object form as a defensive fallback", () => {
    expect(parseTerms({ PerQuery: { price: 5n } })).toEqual({ type: "PerQuery", price: "5" });
    expect(parseTerms({ PerEpoch: { price: 7n, epochSeconds: 86400 } })).toEqual({
      type: "PerEpoch",
      price: "7",
      epochSeconds: 86400,
    });
  });

  it("returns undefined for unknown or malformed input", () => {
    expect(parseTerms(["Unknown", "5"])).toBeUndefined();
    expect(parseTerms(null)).toBeUndefined();
    expect(parseTerms("PerQuery")).toBeUndefined();
    expect(parseTerms({})).toBeUndefined();
    expect(parseTerms([])).toBeUndefined();
  });
});
