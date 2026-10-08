param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Prepare', 'MarkLegacy', 'Verify', 'Cleanup')]
    [string]$Action,

    [ValidateSet('report', 'imported', 'legacy', 'refreshed-manual', 'automatic', 'removed-one', 'restored')]
    [string]$Phase = 'report'
)

$ErrorActionPreference = 'Stop'
$CorpusRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'ambit-photo-qa'))
$RoamingProfile = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'com.ambit.qa'))
$LocalProfile = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'com.ambit.qa'))
$DatabasePath = Join-Path $RoamingProfile 'images.db'

function Assert-ExactLeaf([string]$Path, [string]$ExpectedLeaf) {
    $resolved = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ([IO.Path]::GetFileName($resolved) -cne $ExpectedLeaf) {
        throw "Refusing guarded QA operation outside exact '$ExpectedLeaf' leaf: $resolved"
    }
    return $resolved
}

function Remove-GuardedDirectory([string]$Path, [string]$ExpectedLeaf) {
    $resolved = Assert-ExactLeaf $Path $ExpectedLeaf
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

function Invoke-Harness([string[]]$HarnessArgs) {
    & cargo run --quiet --manifest-path src-tauri/Cargo.toml --example photo_qa_harness -- @HarnessArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Photography QA harness failed with exit code $LASTEXITCODE"
    }
}

switch ($Action) {
    'Prepare' {
        Remove-GuardedDirectory $CorpusRoot 'ambit-photo-qa'
        Remove-GuardedDirectory $RoamingProfile 'com.ambit.qa'
        Remove-GuardedDirectory $LocalProfile 'com.ambit.qa'
        Invoke-Harness @('generate', $CorpusRoot)
        $modifiedAt = [DateTimeOffset]::Parse('2026-07-30T12:00:00+02:00').LocalDateTime
        Get-ChildItem -LiteralPath $CorpusRoot -File | Where-Object Name -ne 'manifest.json' | ForEach-Object {
            $_.LastWriteTime = $modifiedAt
        }
        Write-Output "Photography QA corpus: $CorpusRoot"
        Write-Output "Launch isolated app: pnpm run app:qa"
    }
    'MarkLegacy' {
        Invoke-Harness @('mark-legacy', $DatabasePath, $CorpusRoot)
    }
    'Verify' {
        Invoke-Harness @('verify', $DatabasePath, $CorpusRoot, $Phase)
    }
    'Cleanup' {
        Remove-GuardedDirectory $CorpusRoot 'ambit-photo-qa'
        Remove-GuardedDirectory $RoamingProfile 'com.ambit.qa'
        Remove-GuardedDirectory $LocalProfile 'com.ambit.qa'
        Write-Output 'Removed the isolated photography QA corpus and com.ambit.qa profiles.'
    }
}
