import { test } from "node:test";
import assert from "node:assert/strict";
import { AwsClient, signV4 } from "../src/clients/aws.ts";
import type { FetchFn } from "../src/clients/jira.ts";

const EXAMPLE = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

test("SigV4 matches AWS's documented IAM ListUsers example", () => {
  const h = signV4({
    method: "GET",
    url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: "",
    region: "us-east-1",
    service: "iam",
    credentials: EXAMPLE,
    now: new Date("2015-08-30T12:36:00Z"),
  });
  assert.equal(h["x-amz-date"], "20150830T123600Z");
  assert.equal(h.Authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
    "SignedHeaders=content-type;host;x-amz-date, " +
    "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
  assert.equal(h.host, undefined, "fetch sets Host itself");
});

test("session token is sent and signed", () => {
  const h = signV4({ method: "POST", url: "https://sts.eu-west-1.amazonaws.com/", headers: {}, body: "x",
    region: "eu-west-1", service: "sts", credentials: { ...EXAMPLE, sessionToken: "SESSION" } });
  assert.equal(h["x-amz-security-token"], "SESSION");
  assert.match(h.Authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token,/);
});

function fakeFetch(status: number, xml: string, seen: { url?: string; init?: RequestInit } = {}): FetchFn {
  return (async (url: string, init: RequestInit) => {
    seen.url = url; seen.init = init;
    return new Response(xml, { status });
  }) as unknown as FetchFn;
}

test("getCallerIdentity parses the STS response", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const aws = new AwsClient(() => "eu-west-2", async () => EXAMPLE, fakeFetch(200,
    "<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:iam::123456789012:user/sam</Arn>" +
    "<UserId>AIDA1</UserId><Account>123456789012</Account></GetCallerIdentityResult></GetCallerIdentityResponse>", seen));
  assert.deepEqual(await aws.getCallerIdentity(),
    { account: "123456789012", arn: "arn:aws:iam::123456789012:user/sam", userId: "AIDA1" });
  assert.equal(seen.url, "https://sts.eu-west-2.amazonaws.com/");
  assert.equal(seen.init!.body, "Action=GetCallerIdentity&Version=2011-06-15");
});

test("expired session token gives a useful error", async () => {
  const aws = new AwsClient(() => "us-east-1", async () => ({ ...EXAMPLE, sessionToken: "s" }), fakeFetch(403,
    "<ErrorResponse><Error><Code>ExpiredToken</Code><Message>The security token included in the request is expired</Message></Error></ErrorResponse>"));
  await assert.rejects(aws.getCallerIdentity(), /403 ExpiredToken.*expired.*fresh temporary/);
});

test("missing credentials points at the sidebar", async () => {
  const aws = new AwsClient(() => "us-east-1", async () => undefined, fakeFetch(200, ""));
  await assert.rejects(aws.getCallerIdentity(), /DevAssist sidebar/);
});
