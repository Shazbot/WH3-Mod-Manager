# Compress all .json files starting with 'schema_' using zstd at compression level 19

# Check if zstd is available
if (-not (Get-Command "zstd" -ErrorAction SilentlyContinue)) {
    Write-Error "zstd is not installed or not in the system PATH."
    exit 1
}

# Compress each matching .json file
Get-ChildItem -Path . -Filter schema_*.json | ForEach-Object {
    $inputFile = $_.FullName
    $outputFile = "$inputFile.zst"

    Write-Host "Compressing: $inputFile -> $outputFile (level 19)"

    & zstd -19 -f "$inputFile" -o "$outputFile"
}

Write-Host "All matching .json files compressed with zstd."
