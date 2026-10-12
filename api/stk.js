import crypto from "node:crypto";
import {
  redis, TTL_SECONDS, PACKAGES, json, getBody, normalizePhone,
  validMac, validPrivateIp, randomText, darajaAccessToken, stkPassword, timestampKE
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    const body = getBody(req);
    const phone = normalizePhone(body.phone);
    const pkg = PACKAGES[String(body.packageId || "")];
    const mac = String(body.mac || "").toLowerCase();
    const ip = String(body.ip || "");
    if (!phone || !pkg || !validMac(mac) || !validPrivateIp(ip)) {
      return json(res, 400, { error: "Invalid phone, package, or hotspot client details." });
    }

    // Simple per-phone throttle. Do not rely on this alone in production.
    const throttleKey = `throttle:${phone}`;
    const allowed = await redis.set(throttleKey, "1", { nx: true, ex: 30 });
    if (allowed !== "OK") return json(res, 429, { error: "Please wait 30 seconds before requesting another STK Push." });

    const requestId = crypto.randomUUID();
    const statusToken = randomText(48);
    const statusTokenHash = crypto.createHash("sha256").update(statusToken).digest("hex");
    const username = `m${randomText(10)}`;
    const password = randomText(12);
    const timestamp = timestampKE();
    const base = process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke";
    const callbackUrl = process.env.DARAJA_CALLBACK_URL;

    if (!callbackUrl || !callbackUrl.startsWith("https://")) {
      return json(res, 500, { error: "DARAJA_CALLBACK_URL must be a public HTTPS URL." });
    }

    const accessToken = await darajaAccessToken();
    const payload = {
      BusinessShortCode: process.env.DARAJA_SHORTCODE,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: pkg.amount,
      PartyA: phone,
      PartyB: process.env.DARAJA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: "HOTSPOT",
      TransactionDesc: `Hotspot ${pkg.id}`
    };

    const response = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || result.ResponseCode !== "0" || !result.CheckoutRequestID) {
      console.error("STK request rejected", result);
      return json(res, 502, { error: "Safaricom did not accept the STK request. Check Daraja credentials and logs." });
    }

    const payment = {
      requestId,
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID || "",
      statusTokenHash,
      phone,
      packageId: pkg.id,
      amount: pkg.amount,
      uptime: pkg.uptime,
      mac,
      ip,
      username,
      password,
      status: "pending",
      createdAt: Date.now()
    };
    await redis.set(`payment:${result.CheckoutRequestID}`, payment, { ex: TTL_SECONDS });
    return json(res, 200, {
      ok: true,
      checkoutRequestId: result.CheckoutRequestID,
      statusToken,
      customerMessage: result.CustomerMessage || "Check your phone and enter your M-Pesa PIN."
    });
  } catch (e) {
    console.error("STK endpoint error", e);
    return json(res, 500, { error: "Unable to start payment. Check server configuration and logs." });
  }
}
