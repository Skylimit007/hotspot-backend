import crypto from "node:crypto";
import { redis, json, getBody, secureEqual } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const body = getBody(req);
    const checkoutId = String(body.checkoutRequestId || "");
    const statusToken = String(body.statusToken || "");
    if (!checkoutId || statusToken.length < 32) return json(res, 400, { error: "Invalid status request." });

    const payment = await redis.get(`payment:${checkoutId}`);
    if (!payment) return json(res, 404, { status: "expired", message: "Payment session expired. If you paid, contact the hotspot operator with your M-Pesa receipt." });

    const hash = crypto.createHash("sha256").update(statusToken).digest("hex");
    if (!secureEqual(hash, payment.statusTokenHash)) return json(res, 403, { error: "Invalid status token." });

    if (payment.status === "ready") {
      return json(res, 200, { status: "ready", username: payment.username, password: payment.password });
    }
    return json(res, 200, {
      status: payment.status,
      message: payment.status === "pending" ? "Waiting for Safaricom payment confirmation." :
        payment.status === "queued" ? "Payment confirmed. Waiting for the router to create your access account." :
        payment.status === "failed" ? "Payment was not completed." :
        payment.status === "review" ? "Payment requires operator review. Keep your M-Pesa receipt." :
        "Payment is being processed."
    });
  } catch (e) {
    console.error("Status endpoint error", e);
    return json(res, 500, { error: "Could not check payment status." });
  }
}
