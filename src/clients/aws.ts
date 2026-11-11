// AWS credentials check via STS GetCallerIdentity, signed with SigV4 using node:crypto
// so the extension doesn't need to bundle the AWS SDK. No VS Code types: unit-tested.

import { createHash, createHmac } from "crypto";
import type { FetchFn } from "./jira";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present for temporary credentials (STS / SSO / assumed role). */
  sessionToken?: string;
}

export interface CallerIdentity { account: string; arn: string; userId: string }

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: string;
  /** Headers to send and sign. `host` is added automatically. */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now?: Date;
}

/** Returns the headers to send (including Authorization and X-Amz-Date). */
export function signV4(input: SignInput): Record<string, string> {
  const u = new URL(input.url);
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...input.headers, host: u.host, "x-amz-date": amzDate };
  if (input.credentials.sessionToken) { headers["x-amz-security-token"] = input.credentials.sessionToken; }

  const lower = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(";");
  const canonicalHeaders = lower.map(([k, v]) => `${k}:${v}\n`).join("");

  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    input.method.toUpperCase(),
    u.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    sha256(input.body),
  ].join("\n");

  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const out: Record<string, string> = { ...headers };
  delete out.host; // fetch sets Host itself and refuses to override it
  out.Authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

export class AwsClient {
  constructor(
    private readonly region: () => string,
    private readonly credentials: () => PromiseLike<AwsCredentials | undefined>,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  /** Who the stored credentials belong to. Needs no IAM permissions. */
  async getCallerIdentity(): Promise<CallerIdentity> {
    const creds = await this.credentials();
    if (!creds) {
      throw new Error("AWS is not configured. Add credentials in the DevAssist sidebar.");
    }
    const region = this.region().trim() || "us-east-1";
    const url = `https://sts.${region}.amazonaws.com/`;
    const body = "Action=GetCallerIdentity&Version=2011-06-15";
    const headers = signV4({
      method: "POST",
      url,
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      body,
      region,
      service: "sts",
      credentials: creds,
    });
    const res = await this.fetchFn(url, { method: "POST", headers, body });
    const xml = await res.text();
    if (!res.ok) {
      const code = tag(xml, "Code");
      const message = tag(xml, "Message");
      const hint = code === "ExpiredToken"
        ? " The session token has expired; paste fresh temporary credentials."
        : code === "InvalidClientTokenId" || code === "SignatureDoesNotMatch"
          ? " Check the access key ID and secret access key."
          : "";
      throw new Error(`AWS STS returned ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}.${hint}`);
    }
    return { account: tag(xml, "Account") ?? "", arn: tag(xml, "Arn") ?? "", userId: tag(xml, "UserId") ?? "" };
  }
}
