[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:5188',
  [string]$AiUrl = 'http://localhost:8000',
  [switch]$HealthOnly,
  [string]$Username,
  [string]$ImagePath
)

$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-JsonPost(
  [string]$Url,
  [object]$Body,
  [string]$CsrfToken,
  [Microsoft.PowerShell.Commands.WebRequestSession]$Session
) {
  Invoke-RestMethod -Uri $Url -Method Post -WebSession $Session `
    -Headers @{ 'X-CSRF-Token' = $CsrfToken } `
    -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20 -Compress)
}

$backendHealth = Invoke-RestMethod -Uri "$BaseUrl/healthz" -TimeoutSec 15
Assert-True ($backendHealth.ok -eq $true) 'Backend health check failed.'

$aiHealth = Invoke-RestMethod -Uri "$AiUrl/health" -TimeoutSec 30
Assert-True ($aiHealth.ok -eq $true) 'AI service is not ready.'
Assert-True ($aiHealth.models.kptnetv1 -eq $true) 'KptNetV1 is not loaded.'
Assert-True ($aiHealth.models.damagenetv1 -eq $true) 'DamageNetV1 is not loaded.'

$homeResponse = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing -TimeoutSec 15
Assert-True ($homeResponse.StatusCode -eq 200) 'Frontend did not return HTTP 200.'
Assert-True ($homeResponse.Content -match '<div id="root">') 'Frontend HTML is not the expected Vite application.'

if ($HealthOnly) {
  Write-Host 'PASS: frontend, backend, and AI health checks succeeded.'
  exit 0
}

if (-not $Username) { throw 'Pass -Username for the authenticated end-to-end test.' }
if (-not $ImagePath) { throw 'Pass -ImagePath with a sharp JPEG, PNG, or WebP vehicle image.' }
$resolvedImage = (Resolve-Path -LiteralPath $ImagePath).Path

$extension = [IO.Path]::GetExtension($resolvedImage).ToLowerInvariant()
$mime = switch ($extension) {
  '.jpg'  { 'jpeg' }
  '.jpeg' { 'jpeg' }
  '.png'  { 'png' }
  '.webp' { 'webp' }
  default { throw 'ImagePath must be JPEG, PNG, or WebP.' }
}
$imageData = "data:image/$mime;base64,$([Convert]::ToBase64String([IO.File]::ReadAllBytes($resolvedImage)))"

$securePassword = Read-Host 'Admin password' -AsSecureString
$password = [Net.NetworkCredential]::new('', $securePassword).Password
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

$csrf = Invoke-RestMethod -Uri "$BaseUrl/api/auth/csrf" -WebSession $session -TimeoutSec 15
$login = Invoke-JsonPost "$BaseUrl/api/auth/login" @{ username = $Username; password = $password } $csrf.csrfToken $session
Assert-True ($login.ok -eq $true) 'Login failed.'

$quality = Invoke-JsonPost "$BaseUrl/api/photos/quality-check" @{
  imageData = $imageData
  filename = [IO.Path]::GetFileName($resolvedImage)
  phase = 'return'
  slot = 'front'
  rentalId = 'docker-smoke'
  plate = 'TEST-001'
} $login.csrfToken $session
Assert-True ($quality.ok -eq $true -and $quality.quality.passed -eq $true) 'Image quality validation did not pass.'

$guidance = Invoke-JsonPost "$BaseUrl/api/photos/capture-guidance" @{
  photoId = $quality.photoId
  imageData = $imageData
} $login.csrfToken $session
Assert-True ($guidance.ok -eq $true) 'Capture-guidance integration failed.'

$damage = Invoke-JsonPost "$BaseUrl/api/photos/condition-check" @{
  photoId = $quality.photoId
} $login.csrfToken $session
Assert-True ($damage.ok -eq $true -and $damage.damage.inference_status -eq 'success') 'Damage integration failed.'

[pscustomobject]@{
  result = 'PASS'
  photoId = $quality.photoId
  guidanceStatus = $guidance.guidance.guidance_status
  guidanceSuccess = $guidance.guidance.success
  damageStatus = $damage.damage.damage_status
  damageDetections = $damage.damage.detection_count
} | Format-List
