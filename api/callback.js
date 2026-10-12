import crypto from "node:crypto";
import { redis, TTL_SECONDS, json, verifyStkQuery } from "./_lib.js";

function metaValue(items, name) {
  const item = Array.isArray(items) ? items.find(x => x.Name === name) : null;
  return item ? item.Value : undefined;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) {
      // Respond 200 to avoid endless retries for unrelated malformed callbacks,
      // but log the issue for operator review.
      console.warn("Daraja callback missing CheckoutRequestID");
      return json(res, 200, { ResultCode: 0, ResultDesc: "Received" });
    }

    const checkoutId = String(callback.CheckoutRequestID);
    const key = `payment:${checkoutId}`;
    const payment = await redis.get(key);
    if (!payment) {
      console.warn("Callback has no matching unexpired payment", checkoutId);
      return json(res, 200, { ResultCode: 0, ResultDesc: "Received" });
    }

    if (payment.status === "queued" || payment.status === "ready" || payment.status === "paid") {
      return json(res, 200, { ResultCode: 0, ResultDesc: "Already processed" });
    }

    const resultCode = Number(callback.ResultCode);
    if (resultCode !== 0) {
      payment.status = "failed";
      payment.failureReason = String(callback.ResultDesc || "Payment failed").slice(0, 160);
      await redis.set(key, payment, { ex: Math.max(60, Math.floor((payment.createdAt + TTL_SECONDS * 1000 - Date.now()) / 1000)) });
      return json(res, 200, { ResultCode: 0, ResultDesc: "Received" });
    }

    // Callback URLs are public and should not be the sole proof of payment.
    // Cross-check the opaque checkout ID against Daraja's STK Query API before provisioning.
    const query = await verifyStkQuery(checkoutId);
    if (!query.ok) {
      payment.status = "review";
      payment.failureReason = `Daraja query did not confirm success: ${String(query.resultDesc).slice(0, 120)}`;
      await redis.set(key, payment, { ex: TTL_SECONDS });
      console.warn("Daraja STK Query did not confirm payment", checkoutId, query.resultCode);
      return json(res, 200, { ResultCode: 0, ResultDesc: "Received for review" });
    }

    const items = callback.CallbackMetadata?.Item || [];
    const amount = Number(metaValue(items, "Amount"));
    const receipt = String(metaValue(items, "MpesaReceiptNumber") || "");
    const phone = String(metaValue(items, "PhoneNumber") || "");

    // Match successful callback against the original requested amount and phone.
    if (amount !== Number(payment.amount) || phone !== payment.phone || !receipt) {
      console.error("Callback metadata mismatch", { checkoutId, amount, phone });
      payment.status = "review";
      payment.failureReason = "Callback metadata mismatch; manual reconciliation required";
      await redis.set(key, payment, { ex: TTL_SECONDS });
      return json(res, 200, { ResultCode: 0, ResultDesc: "Received for review" });
    }

    const jobId = crypto.randomUUID();
    const job = {
      jobId,
      checkoutRequestId: checkoutId,
      username: payment.username,
      password: payment.password,
      uptime: payment.uptime,
      mac: payment.mac,
      ip: payment.ip,
      receipt,
      amount: payment.amount,
      createdAt: Date.now()
    };
    await redis.set(`job:${jobId}`, job, { ex: TTL_SECONDS });
    await redis.zadd("router:pending", { score: Date.now(), member: jobId });

    payment.status = "queued";
    payment.receipt = receipt;
    payment.jobId = jobId;
    await redis.set(key, payment, { ex: TTL_SECONDS });
    return json(res, 200, { ResultCode: 0, ResultDesc: "Received" });
  } catch (e) {
    console.error("Callback processing error", e);
    // Return a non-200 so Safaricom can retry where supported.
    return json(res, 500, { ResultCode: 1, ResultDesc: "Temporary processing failure" });
  }
}
