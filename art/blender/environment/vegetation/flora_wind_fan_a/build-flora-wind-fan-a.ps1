param(
  [string]$BlenderPath = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
)

$ErrorActionPreference = "Stop"
$AssetId = "flora_wind_fan_a"
$AssetRoot = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Resolve-Path (Join-Path $AssetRoot "..\..\..\..")
$Source = Join-Path $PSScriptRoot "$AssetId.blend"
$Preview = Join-Path $ProjectRoot "public\assets\environment\previews\$AssetId.png"
$Glb = Join-Path $ProjectRoot "public\assets\environment\models\$AssetId.glb"
$Report = Join-Path $ProjectRoot "art\reports\$AssetId.json"
$Builder = Join-Path $PSScriptRoot "build_flora_wind_fan_a.py"
$Validator = Join-Path $ProjectRoot "tools\blender\validate_asset.py"
$Exporter = Join-Path $ProjectRoot "tools\blender\export_glb.py"

if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender executable not found: $BlenderPath" }
& $BlenderPath --background --factory-startup --python $Builder --python-exit-code 1 -- --source $Source --preview $Preview --asset-id $AssetId
if ($LASTEXITCODE -ne 0) { throw "Blender source build failed" }
& $BlenderPath --background $Source --python $Validator --python-exit-code 1 -- --asset-id $AssetId --report $Report
if ($LASTEXITCODE -ne 0) { throw "Blender validation failed" }
& $BlenderPath --background $Source --python $Exporter --python-exit-code 1 -- --asset-id $AssetId --output $Glb
if ($LASTEXITCODE -ne 0) { throw "GLB export failed" }

# Asset-local GLB validation intentionally does not modify the shared manifest.
$bytes = (Get-Item -LiteralPath $Glb).Length
$header = [System.IO.File]::ReadAllBytes($Glb)
if ($header.Length -lt 20 -or [BitConverter]::ToUInt32($header, 0) -ne 0x46546C67 -or [BitConverter]::ToUInt32($header, 4) -ne 2) {
  throw "Invalid GLB header"
}
$reportData = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
$reportData | Add-Member -NotePropertyName glbBytes -NotePropertyValue $bytes
$reportData | Add-Member -NotePropertyName glbValidation -NotePropertyValue "passed"
$reportData | Add-Member -NotePropertyName preview -NotePropertyValue ("public/assets/environment/previews/{0}.png" -f $AssetId)
$reportData | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding utf8
Write-Output "FACTORYX_ASSET_VALIDATED=$AssetId bytes=$bytes"
