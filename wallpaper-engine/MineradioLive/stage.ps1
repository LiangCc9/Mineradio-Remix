[CmdletBinding()]
param(
  [string]$SourcePublic = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($SourcePublic)) {
  $SourcePublic = Join-Path $PSScriptRoot '..\..\public'
}
$source = (Resolve-Path -LiteralPath $SourcePublic).Path
$target = Join-Path $PSScriptRoot 'app'

if (-not (Test-Path -LiteralPath (Join-Path $source 'index.html'))) {
  throw "Mineradio public directory is invalid: $source"
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath $source -Recurse -File -Force |
  Where-Object { $_.Name -ne 'MiSans-Regular.woff2' } |
  ForEach-Object {
    $relativePath = $_.FullName.Substring($source.Length).TrimStart('\')
    $destination = Join-Path $target $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
}

Write-Host "Wallpaper Engine project staged: $PSScriptRoot"
Write-Host "Open project.json in Wallpaper Engine, or copy this directory into projects\myprojects."
