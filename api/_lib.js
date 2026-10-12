
import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

export const TTL_SECONDS = 1800;

export const PACKAGES = {
  "1h": {
    id: "1h",
    label: "1 Hour",
    amount: 20,
    uptime: "1h"
  },
  "5h": {
    id: "5h",
    label: "5 Hours",
    amount: 50,
    uptime: "5h"
  },
  "24h": {
    id: "24h",
    label: "24 Hours",
    amount: 100,
    uptime: "1d"
  }
};

export function json(res, status, body) {
  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-store");

  return res.send(JSON.stringify(body));
}

/**
 * Safely read the request body.
 *
 * Some Vercel runtime request-body parsers expose req.body
 * through a getter that can throw when the incoming JSON is
 * malformed. Catch that error so it does not escape the handler.
 */
export function getBody(req) {
  try {
    const body = req.body;

    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body)
    ) {
      return body;
    }

    if (typeof body === "string") {
      const parsed = JSON.parse(body);

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
    }

    return {};
  } catch (error) {
    console.error(
      "Request body parsing failed:",
      error?.message || "Unknown parsing error"
    );

    return {};
  }
}

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");

  // Kenyan mobile number beginning with 0.
  if (/^0[17]\d{8}$/.test(digits)) {
    return "254" + digits.slice(1);
  }

  // Kenyan number already using country code 254.
  if (/^254[17]\d{8}$/.test(digits)) {
    return digits;
  }

  // Kenyan mobile number without the leading 0 or country code.
  if (/^[17]\d{8}$/.test(digits)) {
    return "254" + digits;
  }

  return null;
}

export function validMac(value) {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(
    String(value || "")
  );
}

export function validPrivateIp(value) {
  const s = String(value || "");

  const match = s.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  );

  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);

  if (octets.some((n) => n < 0 || n > 255)) {
    return false;
  }

  // This hotspot backend accepts clients on 192.168.89.0/24.
  return (
    octets[0] === 192 &&
    octets[1] === 168 &&
    octets[2] === 89 &&
    octets[3] > 0 &&
    octets[3] < 255
  );
}

export function secureEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  return (
    aa.length === bb.length &&
    crypto.timingSafeEqual(aa, bb)
  );
}

export function routerAuthorized(req) {
  const token = process.env.ROUTER_TOKEN;

  const header = String(
    req.headers.authorization || ""
  );

  return (
    !!token &&
    token.length >= 32 &&
    secureEqual(header, `Bearer ${token}`)
  );
}

export function randomText(length = 12) {
  return crypto
    .randomBytes(length)
    .toString("hex")
    .slice(0, length);
}

export async function darajaAccessToken() {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;

  const base =
    process.env.DARAJA_BASE_URL ||
    "https://sandbox.safaricom.co.ke";

  if (!key || !secret) {
    throw new Error(
      "Daraja credentials are not configured"
    );
  }

  const auth = Buffer
    .from(`${key}:${secret}`)
    .toString("base64");

  const response = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    console.error(
      "Daraja OAuth failed:",
      response.status,
      data
    );

    throw new Error("Daraja OAuth failed");
  }

  return data.access_token;
}

export function stkPassword(timestamp) {
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;

  if (!shortcode || !passkey) {
    throw new Error(
      "Daraja shortcode/passkey are not configured"
    );
  }

  return Buffer
    .from(`${shortcode}${passkey}${timestamp}`)
    .toString("base64");
}

export function timestampKE() {
  const date = new Date(
    Date.now() + 3 * 60 * 60 * 1000
  );

  return date
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
}

export async function verifyStkQuery(checkoutRequestId) {
  const accessToken = await darajaAccessToken();
  const timestamp = timestampKE();

  const base =
    process.env.DARAJA_BASE_URL ||
    "https://sandbox.safaricom.co.ke";

  const response = await fetch(
    `${base}/mpesa/stkpushquery/v1/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        BusinessShortCode: process.env.DARAJA_SHORTCODE,
        Password: stkPassword(timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      })
    }
  );

  const data = await response.json();

  return {
    ok:
      response.ok &&
      String(data.CheckoutRequestID || "") ===
        String(checkoutRequestId) &&
      String(data.ResultCode) === "0",

    resultCode: data.ResultCode,

    resultDesc:
      data.ResultDesc ||
      data.ResponseDescription ||
      "No query description"
  };
}
