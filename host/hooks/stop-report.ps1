# Claude Code Stop hook reporter. Forwards stop event to the local host so the
# phone notification can show this session's last reply.
#
# Robust extraction: do NOT use ConvertFrom-Json (PS 5.1 chokes on some payloads
# and mis-decodes UTF-8). Regex-extract the ASCII fields straight from raw text.
# Claude's session_id IS the transcript filename, so the host can build the exact
# path from it. session_id is present in every hook payload. ASCII-only file on
# purpose (PS 5.1 reads .ps1 as GBK).
$raw = [Console]::In.ReadToEnd()

$claudeSid = ''
if ($raw -match '"session_id"\s*:\s*"([^"]+)"') { $claudeSid = $matches[1] }

$tp = ''
if ($raw -match '"transcript_path"\s*:\s*"([^"]+)"') { $tp = $matches[1] -replace '\\\\', '\' }

if ($env:CC_HOST_SESSION_ID) {
  try {
    $b = @{ sessionId = $env:CC_HOST_SESSION_ID; kind = 'stop'; transcriptPath = $tp; claudeSessionId = $claudeSid } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri 'http://127.0.0.1:8787/hook' -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 4 | Out-Null
  } catch {}
}
