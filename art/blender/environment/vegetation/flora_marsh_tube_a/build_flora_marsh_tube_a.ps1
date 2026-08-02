param(
  [string]$BlenderPath = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
)

$ErrorActionPreference = "Stop"
$AssetId = "flora_marsh_tube_a"
$AssetDir = $PSScriptRoot
$ProjectRoot = Resolve-Path (Join-Path $AssetDir "..\..\..\..\..")
$Source = Join-Path $AssetDir "$AssetId.blend"
$Preview = Join-Path $ProjectRoot "public\assets\environment\previews\$AssetId.png"
$Glb = Join-Path $ProjectRoot "public\assets\environment\models\$AssetId.glb"
$Report = Join-Path $ProjectRoot "art\reports\$AssetId.json"

if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender executable not found: $BlenderPath" }

& $BlenderPath --background --factory-startup --python (Join-Path $AssetDir "build_flora_marsh_tube_a.py") --python-exit-code 1 -- --source $Source --preview $Preview --asset-id $AssetId
if ($LASTEXITCODE -ne 0) { throw "Blender source build failed" }
& $BlenderPath --background $Source --python (Join-Path $ProjectRoot "tools\blender\validate_asset.py") --python-exit-code 1 -- --asset-id $AssetId --report $Report
if ($LASTEXITCODE -ne 0) { throw "Blender validation failed" }
& $BlenderPath --background $Source --python (Join-Path $ProjectRoot "tools\blender\export_glb.py") --python-exit-code 1 -- --asset-id $AssetId --output $Glb
if ($LASTEXITCODE -ne 0) { throw "GLB export failed" }

Write-Host "FactoryX asset complete: $AssetId"
