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
    if (job) await redis.zadd("router:pending", { score: Date.now() + 15000, member: jobId });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send("DEFERRED");
  } catch (e) {
    console.error("Router defer error", e);
    return json(res, 500, { error: "Could not defer job" });
  }
}
