# MikroTik hAP lite M-Pesa hotspot (RouterOS 6, Vercel + Upstash Redis)

This is a starter implementation, not a production-certified payment system. Test with Daraja sandbox first.

## Architecture
- MikroTik stores hotspot users and their `limit-uptime`.
- Vercel Node.js functions initiate Daraja STK Push and process the callback.
- Upstash Redis is a temporary queue/payment-state store. Payment records and jobs expire after 30 minutes.
- RouterOS polls Vercel over outbound HTTPS. Jobs are deferred briefly if the client IP/MAC is not currently visible to the hotspot. Do not port-forward the router's management ports.
- The router creates a hotspot account only after a successful callback is validated against the stored checkout request, amount, phone and package.

## 1. Create Upstash Redis
Create a Redis database in Upstash and copy its HTTPS REST URL and token. This is temporary operational state, not a relational customer database. Do not expose these values in frontend code.

## 2. Deploy to Vercel
1. Upload these files to a GitHub repository or deploy using the Vercel CLI.
2. Import the repository into Vercel.
3. Add every variable from `.env.example` in Project Settings > Environment Variables.
4. Set `DARAJA_CALLBACK_URL` to `https://YOUR-PROJECT.vercel.app/api/callback`.
5. Keep `DARAJA_BASE_URL=https://sandbox.safaricom.co.ke` until sandbox tests pass.
6. Redeploy after adding/changing environment variables.

Vercel automatically deploys Node.js functions in `api/`. The frontend is `index.html`.

## 3. Configure RouterOS 6
1. Confirm the router's hotspot interface/server and client subnet are correct.
2. In RouterOS, install a trusted CA certificate bundle and ensure system time/NTP are correct. The script uses certificate checking; do not disable TLS validation.
3. Edit `routeros6/poller.rsc`: set `BASE_URL`, `ROUTER_ID`, `ROUTER_TOKEN`, and the hotspot subnet assumptions.
4. Upload `poller.rsc` to RouterOS Files so you can open/copy it, but do not assume `/import` creates a saved Script entry. Create a Script entry and paste the file contents into its Source field.
5. Create a scheduler to run `mpesa-poller` every 10 seconds. Do not run overlapping copies.
6. Restrict RouterOS administration to LAN only. Never publish Winbox, SSH, API, or WebFig to the internet.

## 4. Hotspot portal integration
Upload `hotspot-login.html` as the hotspot login page or merge its form/redirect logic into your existing login page. Replace `https://YOUR-PROJECT.vercel.app` with your deployed domain.
The browser must supply `mac`, `ip`, and `loginUrl` from MikroTik's hotspot page variables. The router independently checks that the IP/MAC pair appears in `/ip hotspot host` before creating an account. These values are still not a cryptographic proof of identity; keep the hotspot network isolated and use RouterOS firewalling.

## 5. Test procedure
1. Use Daraja sandbox credentials and a test phone/shortcode supported by your sandbox account.
2. Open the hotspot login page from a client connected to the hotspot.
3. Select a package and request STK Push.
4. Verify the callback is received in Vercel logs. A browser redirect is never treated as proof of payment.
5. Watch `/log print` on the router. The router should retrieve the job, verify the client IP/MAC in the hotspot host table, create a user with the expected uptime, and acknowledge the job.
6. Only after router acknowledgement should the browser receive login credentials.
7. Test cancellation, wrong PIN, delayed callback, repeated callback, router offline, and duplicate polling.
8. Before live payments, review Safaricom's current Daraja documentation and obtain approval for the production shortcode/passkey/callback.

## Security and operational notes
- Never commit `.env` or share your Redis token, Daraja secret/passkey, or router token.
- The public callback endpoint is matched to a pending opaque CheckoutRequestID, cross-checks it with Daraja STK Query, and checks callback amount/phone against the requested amount and phone. Safaricom callbacks should still be monitored; never trust the browser as a payment source. If query verification is inconclusive, access is withheld and the payment requires reconciliation.
- Redis keys expire after 30 minutes. A router offline longer than that can leave a customer paid but not provisioned. Monitor this and create a manual reconciliation/refund procedure before accepting real money.
- The starter rate-limits STK requests per phone using Redis, but production should also add IP/device throttling, abuse monitoring, stronger session binding, and transaction reconciliation.
- RouterOS v6 Fetch syntax and certificate handling differ across v6 releases. Test on your exact version before using this on a live network.
- `limit-uptime` limits connected time, not necessarily wall-clock time from purchase. A package labelled “24 hours” here means 24 hours of accumulated connected time. Use a separate expiry policy if you mean a fixed 24-hour wall-clock window.
