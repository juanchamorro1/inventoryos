import { describe, expect, it } from "vitest";
import { presignUrl, uriEncode } from "@/server/s3-sign";

describe("firma SigV4 para URLs prefirmadas", () => {
  it("coincide con el ejemplo oficial de AWS (Authenticating Requests: Using Query Parameters)", () => {
    const url = presignUrl({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" },
      expiresSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request");
    expect(url.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")).toBe(true);
  });

  it("codifica la ruta conservando las barras", () => {
    expect(uriEncode("orgs/a b/ñ.png", true)).toBe("orgs/a%20b/%C3%B1.png");
    expect(uriEncode("a/b")).toBe("a%2Fb");
  });
});
