param(
  [string]$BlenderPath = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$AssetId = "rock_basalt_medium_a"
$Source = Join-Path $ProjectRoot "art\blender\environment\rocks\$AssetId\$AssetId.blend"
$Preview = Join-Path $ProjectRoot "public\assets\environment\previews\$AssetId.png"
$Glb = Join-Path $ProjectRoot "public\assets\environment\models\$AssetId.glb"
$Report = Join-Path $ProjectRoot "art\reports\$AssetId.json"
$Manifest = Join-Path $ProjectRoot "public\assets\environment\manifests\environment-assets.json"

if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender executable not found: $BlenderPath" }

& $BlenderPath --background --factory-startup --python (Join-Path $PSScriptRoot "build_basalt_asset.py") --python-exit-code 1 -- --source $Source --preview $Preview --asset-id $AssetId
if ($LASTEXITCODE -ne 0) { throw "Blender source build failed" }
& $BlenderPath --background $Source --python (Join-Path $PSScriptRoot "validate_asset.py") --python-exit-code 1 -- --asset-id $AssetId --report $Report
if ($LASTEXITCODE -ne 0) { throw "Blender validation failed" }
& $BlenderPath --background $Source --python (Join-Path $PSScriptRoot "export_glb.py") --python-exit-code 1 -- --asset-id $AssetId --output $Glb
if ($LASTEXITCODE -ne 0) { throw "GLB export failed" }
node (Join-Path $ProjectRoot "tools\assets\validate-environment-glb.mjs") $Glb $Report $Manifest
if ($LASTEXITCODE -ne 0) { throw "GLB manifest validation failed" }

& (Join-Path $PSScriptRoot "build-windglass-shard-asset.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Windglass shard asset build failed" }

& (Join-Path $PSScriptRoot "build-hematite-slab-asset.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Hematite slab asset build failed" }

& (Join-Path $ProjectRoot "art\blender\environment\vegetation\flora_wind_fan_a\build-flora-wind-fan-a.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Wind fan asset build failed" }

& (Join-Path $ProjectRoot "art\blender\environment\vegetation\flora_marsh_tube_a\build_flora_marsh_tube_a.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Marsh tube asset build failed" }

& (Join-Path $ProjectRoot "art\blender\environment\vegetation\flora_sail_membrane_a\build_flora_sail_membrane_a.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Sail membrane asset build failed" }

& (Join-Path $ProjectRoot "art\blender\environment\rocks\rock_layered_plate_a\build-rock-layered-plate-a.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Layered plate asset build failed" }

& (Join-Path $ProjectRoot "art\blender\environment\landmarks\landmark_twin_needles_a\build_landmark_twin_needles_a.ps1") -BlenderPath $BlenderPath
if ($LASTEXITCODE -ne 0) { throw "Twin needles landmark build failed" }
