param(
  [string]$BlenderPath = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
)

$ErrorActionPreference = "Stop"
$AssetId = "landmark_iron_ribs_a"
$AssetDir = $PSScriptRoot
$ProjectRoot = Resolve-Path (Join-Path $AssetDir "..\..\..\..\..")
$Source = Join-Path $AssetDir "$AssetId.blend"
$Preview = Join-Path $ProjectRoot "public\assets\environment\previews\$AssetId.png"
$Glb = Join-Path $ProjectRoot "public\assets\environment\models\$AssetId.glb"
$Report = Join-Path $ProjectRoot "art\reports\$AssetId.json"

if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender executable not found: $BlenderPath" }
& $BlenderPath --background --factory-startup --python (Join-Path $AssetDir "build_landmark_iron_ribs_a.py") --python-exit-code 1 -- --source $Source --preview $Preview --asset-id $AssetId
if ($LASTEXITCODE -ne 0) { throw "Blender source build failed" }
& $BlenderPath --background $Source --python (Join-Path $ProjectRoot "tools\blender\validate_asset.py") --python-exit-code 1 -- --asset-id $AssetId --report $Report
if ($LASTEXITCODE -ne 0) { throw "Blender validation failed" }
& $BlenderPath --background $Source --python (Join-Path $ProjectRoot "tools\blender\export_glb.py") --python-exit-code 1 -- --asset-id $AssetId --output $Glb
if ($LASTEXITCODE -ne 0) { throw "GLB export failed" }

# Do not invoke the shared manifest validator: it would mutate shared state.
$Header = [System.IO.File]::ReadAllBytes($Glb)
if ($Header.Length -lt 20 -or [System.BitConverter]::ToUInt32($Header, 0) -ne 0x46546C67 -or [System.BitConverter]::ToUInt32($Header, 4) -ne 2) {
  throw "Export is not a valid glTF 2.0 binary"
}
$ReportData = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
$ReportData | Add-Member -NotePropertyName glbBytes -NotePropertyValue $Header.Length
$ReportData | Add-Member -NotePropertyName glbValidation -NotePropertyValue "passed"
$ReportData | Add-Member -NotePropertyName preview -NotePropertyValue ("public/assets/environment/previews/{0}.png" -f $AssetId)
$ReportData | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding utf8
Write-Host "FACTORYX_ASSET_COMPLETE=$AssetId bytes=$($Header.Length)"
