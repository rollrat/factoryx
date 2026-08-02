param(
  [string]$BlenderPath = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$AssetId = "rock_hematite_slab_a"
$Source = Join-Path $ProjectRoot "art\blender\environment\rocks\$AssetId\$AssetId.blend"
$Preview = Join-Path $ProjectRoot "public\assets\environment\previews\$AssetId.png"
$Glb = Join-Path $ProjectRoot "public\assets\environment\models\$AssetId.glb"
$Report = Join-Path $ProjectRoot "art\reports\$AssetId.json"

if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender executable not found: $BlenderPath" }

& $BlenderPath --background --factory-startup --python (Join-Path $PSScriptRoot "build_hematite_slab_asset.py") --python-exit-code 1 -- --source $Source --preview $Preview --asset-id $AssetId
if ($LASTEXITCODE -ne 0) { throw "Blender source build failed" }
& $BlenderPath --background $Source --python (Join-Path $PSScriptRoot "validate_asset.py") --python-exit-code 1 -- --asset-id $AssetId --report $Report
if ($LASTEXITCODE -ne 0) { throw "Blender validation failed" }
& $BlenderPath --background $Source --python (Join-Path $PSScriptRoot "export_glb.py") --python-exit-code 1 -- --asset-id $AssetId --output $Glb
if ($LASTEXITCODE -ne 0) { throw "GLB export failed" }

# Do not call validate-environment-glb.mjs here: it mutates the shared manifest.
# The Blender report remains asset-specific; this check confirms a glTF 2.0 GLB.
$Header = [System.IO.File]::ReadAllBytes($Glb)
if ($Header.Length -lt 20 -or [System.BitConverter]::ToUInt32($Header, 0) -ne 0x46546C67 -or [System.BitConverter]::ToUInt32($Header, 4) -ne 2) {
  throw "Export is not a valid glTF 2.0 binary"
}
Write-Host "FACTORYX_ASSET_COMPLETE=$AssetId bytes=$($Header.Length)"
