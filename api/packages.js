import { PACKAGES, json } from "./_lib.js";

export default function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  return json(res, 200, { packages: Object.values(PACKAGES).map(({id,label,amount}) => ({id,label,amount})) });
}
