## RouterOS 6 installation notes

1. Confirm your exact RouterOS version with `/system resource print`.
2. Confirm the hotspot subnet; this starter assumes `192.168.100.0/24`, gateway commonly `192.168.100.1`.
3. Upload `poller.rsc` to Files and edit the URL/token/router ID. Create a Script entry named `mpesa-poller` in System > Scripts and paste the file contents into its Source field. A RouterOS `/import` executes commands; it does not automatically create a saved Script entry.
4. Create the scheduler (run in terminal):
   `/system scheduler add name=mpesa-poller interval=10s on-event="/system script run mpesa-poller" start-time=startup`
5. Make sure `mpesa-poller` has sufficient policy permissions for fetch, read, write, policy, test, and sensitive operations required by your ROS 6 version.
6. TLS certificate validation is intentionally enabled. If fetch fails because the router lacks trusted root certificates, install/update the proper CA certificate bundle and check NTP/system time. Do not set `check-certificate=no`.
7. The exact RouterOS v6 minor release may reject some `fetch` options or script syntax. Test interactively first and adjust against the manual for that version.
