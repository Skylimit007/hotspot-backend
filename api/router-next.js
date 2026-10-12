import { redis, json, routerAuthorized } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  if (!routerAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
  if (String(req.query?.routerId || "") !== String(process.env.ROUTER_ID || "haplite01")) {
    return json(res, 403, { error: "Unknown router" });
  }

  try {
    // Only one router is assumed. Job stays pending until ACK; TTL handles stale jobs.
    for (let i = 0; i < 5; i++) {
      const ids = await redis.zrange("router:pending", 0, Date.now(), { byScore: true, offset: 0, count: 1 });
      if (!ids || !ids.length) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send("NOJOB");
      }
      const jobId = String(ids[0]);
      const job = await redis.get(`job:${jobId}`);
      if (!job) {
        await redis.zrem("router:pending", jobId);
        continue;
      }
      // Strict allow-list prevents delimiter/newline injection into RouterOS parser.
      const safe = [job.jobId, job.username, job.password, job.uptime, job.mac, job.ip];
      if (safe.some(v => /[,\r\n|]/.test(String(v)))) {
        console.error("Unsafe job payload", jobId);
        await redis.zrem("router:pending", jobId);
        continue;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(safe.join(","));
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send("NOJOB");
  } catch (e) {
    console.error("Router-next error", e);
    return json(res, 500, { error: "Queue temporarily unavailable" });
  }
}
