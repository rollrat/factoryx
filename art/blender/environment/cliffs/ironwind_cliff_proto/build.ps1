param(
  [string]$BlenderPath = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
)

$ErrorActionPreference = "Stop"
$OutputDir = $PSScriptRoot
$Builder = Join-Path $PSScriptRoot "build_ironwind_cliff_proto.py"
$Validator = Join-Path $PSScriptRoot "validate_glb.mjs"

if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender executable not found: $BlenderPath" }

& $BlenderPath --background --factory-startup --python $Builder --python-exit-code 1 -- --output-dir $OutputDir
if ($LASTEXITCODE -ne 0) { throw "Ironwind cliff prototype build failed" }

node $Validator $OutputDir
if ($LASTEXITCODE -ne 0) { throw "Ironwind cliff prototype validation failed" }

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\..")
$ModelDir = Join-Path $ProjectRoot "public\assets\environment\models"
$PreviewDir = Join-Path $ProjectRoot "public\assets\environment\previews"
New-Item -ItemType Directory -Force -Path $ModelDir, $PreviewDir | Out-Null
foreach ($AssetId in @("ironwind_cliff_straight_16m", "ironwind_cliff_outer_corner", "ironwind_natural_arch")) {
  Copy-Item -LiteralPath (Join-Path $OutputDir "$AssetId.glb") -Destination (Join-Path $ModelDir "$AssetId.glb") -Force
  Copy-Item -LiteralPath (Join-Path $OutputDir "${AssetId}_preview_front.png") -Destination (Join-Path $PreviewDir "$AssetId.png") -Force
}
