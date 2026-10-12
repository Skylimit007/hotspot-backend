import { redis, json, routerAuthorized } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  if (!routerAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

  // RouterOS can send the ID as a header to avoid query-string typing issues.
  const suppliedRouterId = String(req.query?.routerId || req.headers["x-router-id"] || "");
  const expectedRouterId = String(process.env.ROUTER_ID || "haplite01");
  if (suppliedRouterId !== expectedRouterId) return json(res, 403, { error: "Unknown router" });

  try {
    for (let i = 0; i < 5; i++) {
      const ids = await redis.zrange("router:pending", 0, Date.now(), {
        byScore: true, offset: 0, count: 1
      });

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

      const safe = [job.jobId, job.username, job.password, job.uptime, job.mac, job.ip];
      if (safe.some(value => value == null || /[,\r\n|]/.test(String(value)))) {
        console.error("Unsafe or incomplete job payload", jobId);
        await redis.zrem("router:pending", jobId);
        continue;
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(safe.map(value => String(value)).join(","));
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send("NOJOB");
  } catch (error) {
    console.error("Router-next error", error);
    return json(res, 500, { error: "Queue temporarily unavailable" });
  }
}
