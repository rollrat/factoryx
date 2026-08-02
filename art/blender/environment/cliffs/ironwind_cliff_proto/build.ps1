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
