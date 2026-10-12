import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

export const TTL_SECONDS = 1800;
export const PACKAGES = {
  "1h": { id: "1h", label: "1 Hour", amount: 20, uptime: "1h" },
  "5h": { id: "5h", label: "5 Hours", amount: 50, uptime: "5h" },
  "24h": { id: "24h", label: "24 Hours", amount: 100, uptime: "1d" }
};

export function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(JSON.stringify(body));
}

export function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch {}
  }
  return {};
}

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return "254" + digits;
  return null;
}

export function validMac(value) {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(String(value || ""));
}

export function validPrivateIp(value) {
  const s = String(value || "");
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const n = m.slice(1).map(Number);
  if (n.some(x => x < 0 || x > 255)) return false;
  // Adjust this to your actual hotspot subnet if different.
  return n[0] === 192 && n[1] === 168 && n[2] === 89 && n[3] > 0 && n[3] < 255;
}

export function secureEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function routerAuthorized(req) {
  const token = process.env.ROUTER_TOKEN;
  const header = String(req.headers.authorization || "");
  return !!token && token.length >= 32 &&
    secureEqual(header, `Bearer ${token}`);
}

export function randomText(length = 12) {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

export async function darajaAccessToken() {
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  const base = process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke";
  if (!key || !secret) throw new Error("Daraja credentials are not configured");
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const r = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error("Daraja OAuth failed");
  return data.access_token;
}

export function stkPassword(timestamp) {
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  if (!shortcode || !passkey) throw new Error("Daraja shortcode/passkey are not configured");
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export function timestampKE() {
  // Daraja expects YYYYMMDDHHmmss. Kenya is UTC+3.
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return d.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

export async function verifyStkQuery(checkoutRequestId) {
  const accessToken = await darajaAccessToken();
  const timestamp = timestampKE();
  const base = process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke";
  const response = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: process.env.DARAJA_SHORTCODE,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    })
  });
  const data = await response.json();
  return {
    ok: response.ok && String(data.CheckoutRequestID || "") === String(checkoutRequestId) && String(data.ResultCode) === "0",
    resultCode: data.ResultCode,
    resultDesc: data.ResultDesc || data.ResponseDescription || "No query description"
  };
}
