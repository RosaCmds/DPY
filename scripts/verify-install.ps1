$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "dist/DPY-Pet-Setup-$version-x64.exe"
$testRoot = Join-Path $env:RUNNER_TEMP 'DPY-Installer-Payload-Verification'
$absoluteTestRoot = [IO.Path]::GetFullPath($testRoot)
if (-not $absoluteTestRoot.StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test install path' }
$process = Start-Process -FilePath $installer -ArgumentList @('/S', ('/D=' + $absoluteTestRoot)) -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
try {
  $resources = Join-Path $absoluteTestRoot 'resources'
  $videoRoot = Join-Path $resources 'app/node_modules/dsh-pet/assets/webm'
  $videos = @(Get-ChildItem -LiteralPath $videoRoot -File -Filter '*.webm')
  if ($videos.Count -lt 100) { throw "Animation payload incomplete: $($videos.Count) clips" }
  foreach ($video in $videos) {
    $original = Join-Path $projectRoot ('node_modules/dsh-pet/assets/webm/' + $video.Name)
    if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $video.FullName -Algorithm SHA256).Hash) { throw "Corrupt animation: $($video.Name)" }
  }
  $node = Join-Path $resources 'runtime/node.exe'
  $cli = Join-Path $resources 'workbuddy-cli/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy'
  if (-not (Test-Path -LiteralPath $cli)) { throw 'Bundled Tencent CLI missing' }
  & $node --version
  if ($LASTEXITCODE -ne 0) { throw 'Bundled Node cannot run' }
  & $node $cli --version
  if ($LASTEXITCODE -ne 0) { throw 'Bundled Tencent CLI cannot run' }
  Write-Output "Installed payload verified: $($videos.Count) intact animation clips, Node and Tencent CLI."
} finally {
  $uninstaller = Join-Path $absoluteTestRoot 'Uninstall DPY-Pet.exe'
  if ($env:DPY_KEEP_TEST_INSTALL -ne '1' -and (Test-Path -LiteralPath $uninstaller)) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait }
}
