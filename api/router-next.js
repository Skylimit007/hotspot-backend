
import { redis, json, routerAuthorized } from "./_lib.js";

export default async function handler(req, res) {
  // This endpoint accepts GET requests only.
  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  // Verify the Bearer token configured in Vercel.
  if (!routerAuthorized(req)) {
    return json(res, 401, { error: "Unauthorized" });
  }

  // Accept router ID from either the query string or a header.
  // Header support lets RouterOS call this endpoint without '?' in the URL.
  const suppliedRouterId = String(
    req.query?.routerId ||
    req.headers["x-router-id"] ||
    ""
  );

  const expectedRouterId = String(
    process.env.ROUTER_ID || "haplite01"
  );

  if (suppliedRouterId !== expectedRouterId) {
    return json(res, 403, { error: "Unknown router" });
  }

  try {
    // Find a pending job whose scheduled time has arrived.
    for (let i = 0; i < 5; i++) {
      const ids = await redis.zrange(
        "router:pending",
        0,
        Date.now(),
        {
          byScore: true,
          offset: 0,
          count: 1
        }
      );

      if (!ids || ids.length === 0) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send("NOJOB");
      }

      const jobId = String(ids[0]);
      const job = await redis.get(`job:${jobId}`);

      // Remove stale queue entries whose job data has expired.
      if (!job) {
        await redis.zrem("router:pending", jobId);
        continue;
      }

      // Validate fields before returning a comma-separated payload.
      const safe = [
        job.jobId,
        job.username,
        job.password,
        job.uptime,
        job.mac,
        job.ip
      ];

      if (
        safe.some(
          value =>
            value == null ||
            /[,\r\n|]/.test(String(value))
        )
      ) {
        console.error("Unsafe or incomplete job payload", jobId);
        await redis.zrem("router:pending", jobId);
        continue;
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");

      return res.status(200).send(
        safe.map(value => String(value)).join(",")
      );
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send("NOJOB");
  } catch (error) {
    console.error("Router-next error", error);

    return json(res, 500, {
      error: "Queue temporarily unavailable"
    });
  }
}
