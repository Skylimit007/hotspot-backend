# REVIEW AND EDIT BEFORE USE. RouterOS 6 script for a single hAP lite.
# Set Vercel URL, router ID and token to match Vercel environment variables.
# Assumes hotspot clients use 192.168.89.0/24. Test on exact ROS 6 minor version.

:global mpesaBaseUrl "https://hotspot-backend-ebon.vercel.app"
:global mpesaRouterId "haplite01"
:global mpesaRouterToken "itM12EBr4Vgo9tlg1cixc7LW2Mq1H4CzDF7Hk2tC4CWsBp9IDHAYTlo1ScY0Rsfu"

:local nextUrl ($mpesaBaseUrl . "/api/router-next?routerId=" . $mpesaRouterId)
:local fetchResult
:local fetchFailed false
:do {
  :set fetchResult [/tool fetch url=$nextUrl http-header-field=("Authorization: Bearer " . $mpesaRouterToken) output=user as-value check-certificate=yes]
} on-error={
  :set fetchFailed true
  :log warning "M-Pesa poll request failed"
}
:if ($fetchFailed) do={ :return }
:if (($fetchResult->"status") != "finished") do={ :return }
:local payload ($fetchResult->"data")
:if (($payload = "") || ($payload = "NOJOB")) do={ :return }

# API returns: jobId,username,password,uptime,mac,ip
:local fields [:toarray $payload]
:if ([:len $fields] != 6) do={ :log error "M-Pesa poller received malformed job"; :return }
:local jobId ($fields->0)
:local username ($fields->1)
:local password ($fields->2)
:local uptime ($fields->3)
:local mac ($fields->4)
:local ip ($fields->5)

# Defensive validation before using server-supplied values in RouterOS commands.
:if ([:len $jobId] != 36) do={ :log error "Invalid M-Pesa job ID"; :return }
:if ([:len $username] < 2 || [:len $username] > 20) do={ :log error "Invalid M-Pesa username"; :return }
:if ([:len $password] < 8 || [:len $password] > 20) do={ :log error "Invalid M-Pesa password"; :return }
:if (($uptime != "1h") && ($uptime != "5h") && ($uptime != "1d")) do={ :log error "Invalid M-Pesa uptime"; :return }
:if ([:len $mac] != 17) do={ :log error "Invalid M-Pesa MAC"; :return }
:if ([:pick $ip 0 12] != "192.168.89.") do={ :log error "Invalid M-Pesa client IP"; :return }

# Confirm the supplied IP/MAC pair is visible to the hotspot router.
:local hostId [/ip hotspot host find where address=$ip and mac-address=$mac]
:if ([:len $hostId] = 0) do={
  :log warning ("Paid M-Pesa job waiting for matching hotspot host: " . $jobId)
  :local deferUrl ($mpesaBaseUrl . "/api/router-defer?routerId=" . $mpesaRouterId . "&jobId=" . $jobId)
  :do { /tool fetch url=$deferUrl http-header-field=("Authorization: Bearer " . $mpesaRouterToken) output=none check-certificate=yes } on-error={ :log warning "Could not defer M-Pesa job" }
  :return
}

# Idempotency: if a retry arrives after user creation, don't create a duplicate.
:local userId [/ip hotspot user find where name=$username]
:if ([:len $userId] = 0) do={
  /ip hotspot user add name=$username password=$password limit-uptime=$uptime mac-address=$mac comment=("mpesa:" . $jobId)
  :log info ("Created paid hotspot user " . $username . " package " . $uptime)
}

# Acknowledge only after the account exists.
:local ackUrl ($mpesaBaseUrl . "/api/router-ack?routerId=" . $mpesaRouterId . "&jobId=" . $jobId)
:local ackResult
:local ackFailed false
:do {
  :set ackResult [/tool fetch url=$ackUrl http-header-field=("Authorization: Bearer " . $mpesaRouterToken) output=user as-value check-certificate=yes]
} on-error={
  :set ackFailed true
  :log warning "M-Pesa ack failed"
}
:if (!$ackFailed && (($ackResult->"status") = "finished") && (($ackResult->"data") = "OK")) do={
  :log info ("Acknowledged M-Pesa job " . $jobId)
} else={
  :log warning ("M-Pesa job will be retried: " . $jobId)
}
