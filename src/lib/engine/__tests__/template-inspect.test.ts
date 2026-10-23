import { describe, expect, it } from "vitest";
import { redactTemplate, safeText, templateRows } from "@/lib/engine/template-inspect";

describe("redactTemplate", () => {
  it("keeps the layout and hides anyone's data, secrets and image addresses", () => {
    const got = JSON.parse(JSON.stringify(redactTemplate(
      {
        style: "storeCard",
        foregroundColor: "rgb(255,255,255)",
        fields: { header: [{ key: "points", label: "POINTS", value: "${Points}" }], back: [{ label: "Message me", value: "https://facebook.com/x", changeMessage: "%@" }] },
        images: { strip: { url: "https://cdn.example/strip.png", width: 1125, height: 432 } },
        barcode: { format: "PKBarcodeFormatQR", message: "${MEMBER_ID}", altText: "This pass belongs to ${First_Name} ${Last_Name}" },
        sample: { email: "maya@example.com", customer_id: "cus_1", serialNumber: "SER-1", note: "call +1 555 123 4567", owner: "x@y.com" },
        email: "${Email}",
        apiKey: "sk_live_abc",
        echo: "Bearer sk_live_abc",
      },
      "sk_live_abc",
    )));
    expect(got.style).toBe("storeCard");
    expect(got.fields.header[0]).toEqual({ key: "points", label: "POINTS", value: "${Points}" });
    expect(got.fields.back[0].value).toBe("https://facebook.com/x");
    expect(got.fields.back[0].changeMessage).toBe("%@");
    expect(got.images.strip).toEqual({ url: "[image]", width: 1125, height: 432 });
    expect(got.barcode.altText).toBe("This pass belongs to ${First_Name} ${Last_Name}");
    expect(got.sample).toEqual({ email: "[hidden]", customer_id: "[hidden]", serialNumber: "[hidden]", note: "call [number]", owner: "[hidden]" });
    expect(got.email).toBe("${Email}");
    expect(got.apiKey).toBe("[hidden]");
    expect(got.echo).toBe("[hidden]");
    expect(JSON.stringify(got)).not.toMatch(/sk_live|maya|cus_1|SER-1|555/);
  });
  it("cuts long text", () => {
    expect(safeText("a".repeat(300)).length).toBe(201);
  });
});

describe("templateRows", () => {
  it("lists templates newest first with their style, whatever the service calls it", () => {
    const rows = templateRows({ data: [
      { id: "89fd70bc-1111", name: "Legacy", style: "storeCard", created_at: "2026-09-01", updated_at: "2026-09-20" },
      { id: "bc3fe237-aaaa", name: "2026", passStyle: "generic", created_at: "2026-10-01" },
    ] });
    expect(rows.map((r) => [r.shortId, r.style])).toEqual([["bc3fe237", "generic"], ["89fd70bc", "storeCard"]]);
  });
});
