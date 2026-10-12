import { redis, json, routerAuthorized } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  if (!routerAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
  if (String(req.query?.routerId || "") !== String(process.env.ROUTER_ID || "haplite01")) {
    return json(res, 403, { error: "Unknown router" });
  }

  const jobId = String(req.query?.jobId || "");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(res, 400, { error: "Invalid job ID" });

  try {
    const job = await redis.get(`job:${jobId}`);
    if (job) {
      const paymentKey = `payment:${job.checkoutRequestId}`;
      const payment = await redis.get(paymentKey);
      if (payment) {
        payment.status = "ready";
        await redis.set(paymentKey, payment, { ex: 1800 });
      }
      await redis.zrem("router:pending", jobId);
      await redis.del(`job:${jobId}`);
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send("OK");
  } catch (e) {
    console.error("Router ack error", e);
    return json(res, 500, { error: "Could not acknowledge job" });
  }
}
