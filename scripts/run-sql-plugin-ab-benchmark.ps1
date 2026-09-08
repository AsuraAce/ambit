[CmdletBinding()]
param(
    [string]$BaselineExecutable,

    [string]$CandidateExecutable,

    [string]$OutputDirectory,

    [ValidateSet('lock-only')]
    [string]$CandidateProfile = 'lock-only',

    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

function Get-Median {
    param([double[]]$Values)

    if ($Values.Count -eq 0) {
        throw 'Cannot calculate a median from no samples.'
    }

    $sorted = @($Values | Sort-Object)
    $middle = [int][math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 0) {
        return ($sorted[$middle - 1] + $sorted[$middle]) / 2.0
    }
    return $sorted[$middle]
}

function Convert-ValidMilliseconds {
    param($Value, [string]$Context)

    if ($null -eq $Value) {
        $message = "Missing measurement for $Context."
        Write-IncompleteEvidence $message
        throw $message
    }
    try {
        $number = [double]$Value
    }
    catch {
        $message = "Non-numeric measurement for $Context."
        Write-IncompleteEvidence $message
        throw $message
    }
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0.0) {
        $message = "Invalid measurement for ${Context}: $number"
        Write-IncompleteEvidence $message
        throw $message
    }
    return $number
}

function Assert-WarmSeries {
    param($Values, [string]$Context)

    if (@($Values).Count -ne 5) {
        Stop-IncompleteEvidence "Expected five warm samples for $Context, received $(@($Values).Count)."
    }
    foreach ($value in $Values) {
        Convert-ValidMilliseconds $value $Context | Out-Null
    }
}

function Assert-RunnerSelfTest {
    if ((Get-Median @(1.0, 3.0, 5.0)) -ne 3.0) { throw 'Odd-count median self-test failed.' }
    if ((Get-Median @(1.0, 3.0, 5.0, 7.0)) -ne 4.0) { throw 'Even-count median self-test failed.' }
    if ((Convert-ValidMilliseconds 0.0 'self-test') -ne 0.0) { throw 'Zero measurement self-test failed.' }
    foreach ($invalid in @($null, -1.0, [double]::NaN, [double]::PositiveInfinity)) {
        $rejected = $false
        try { Convert-ValidMilliseconds $invalid 'self-test' | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Invalid-measurement self-test failed.' }
    }
    Assert-WarmSeries @(1, 2, 3, 4, 5) 'valid series'
    foreach ($run in 1..12) {
        $rejected = $false
        try { Assert-WarmSeries @() "entirely absent series, run $run" } catch { $rejected = $true }
        if (-not $rejected) { throw 'Entirely missing warm series self-test failed.' }
    }
    Write-Host 'SQL_PLUGIN_AB_RUNNER_SELF_TEST passed'
}

function Resolve-Executable {
    param([string]$Path, [string]$Label)

    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.PSIsContainer) {
        throw "$Label executable path is a directory: $($item.FullName)"
    }
    return $item.FullName
}

function Write-IncompleteEvidence {
    param([string]$Message)

    if ($null -eq $script:evidenceDirectory) { return }
    [ordered]@{
        complete = $false
        status = 'failed'
        error = $Message
        completed_runs = @($script:runs)
        limitations = 'Raw logs are retained for each completed run. This partial matrix must not be presented as an A/B result.'
    } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $script:evidenceDirectory.FullName 'benchmark-incomplete.json') -Encoding utf8
}

function Stop-IncompleteEvidence {
    param([string]$Message)

    Write-IncompleteEvidence $Message
    throw $Message
}

function Invoke-BenchmarkRun {
    param(
        [string]$Executable,
        [ValidateSet('baseline', 'candidate')]
        [string]$Mode,
        [string]$Profile,
        [int]$Pair,
        [int]$Position,
        [string]$Destination
    )

    $logPath = Join-Path $Destination ("pair-{0:D2}-{1}-{2}.log" -f $Pair, $Position, $Mode)
    # Loader failures can occur before the executable writes any output.
    "Benchmark mode=$Mode profile=$Profile pair=$Pair position=$Position" | Set-Content -LiteralPath $logPath -Encoding utf8
    $previousMode = $env:AMBIT_SQL_PLUGIN_BENCHMARK_MODE
    $previousProfile = $env:AMBIT_SQL_PLUGIN_BENCHMARK_PROFILE
    try {
        $env:AMBIT_SQL_PLUGIN_BENCHMARK_MODE = $Mode
        if ($Mode -eq 'candidate') {
            $env:AMBIT_SQL_PLUGIN_BENCHMARK_PROFILE = $Profile
        }
        else {
            Remove-Item Env:AMBIT_SQL_PLUGIN_BENCHMARK_PROFILE -ErrorAction SilentlyContinue
        }
        Write-Host ('SQL_PLUGIN_AB_PROGRESS ' + ([ordered]@{ pair = $Pair; position = $Position; mode = $Mode; phase = 'started' } | ConvertTo-Json -Compress))
        $output = & $Executable --ignored --exact 'db::migrations::sql_plugin_tests::sql_plugin_benchmark::benchmark_sql_plugin_connection_candidate' --nocapture 2>&1 | ForEach-Object {
            Add-Content -LiteralPath $logPath -Value $_ -Encoding utf8
            $_
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $env:AMBIT_SQL_PLUGIN_BENCHMARK_MODE = $previousMode
        $env:AMBIT_SQL_PLUGIN_BENCHMARK_PROFILE = $previousProfile
    }

    if ($exitCode -ne 0) {
        throw "$Mode benchmark pair $Pair position $Position failed with exit code $exitCode. See $logPath"
    }

    $line = @($output | Where-Object { $_ -like 'SQL_PLUGIN_AB_RESULT *' })
    if ($line.Count -ne 1) {
        throw "$Mode benchmark pair $Pair did not emit exactly one SQL_PLUGIN_AB_RESULT. See $logPath"
    }
    $result = $line[0].Substring('SQL_PLUGIN_AB_RESULT '.Length) | ConvertFrom-Json
    if ($result.mode -ne $Mode) {
        throw "$Mode benchmark pair $Pair reported mode '$($result.mode)'. See $logPath"
    }
    Write-Host ('SQL_PLUGIN_AB_PROGRESS ' + ([ordered]@{ pair = $Pair; position = $Position; mode = $Mode; phase = 'completed' } | ConvertTo-Json -Compress))
    return [pscustomobject]@{
        Mode = $Mode
        Pair = $Pair
        Position = $Position
        Log = $logPath
        Result = $result
    }
}

$script:baseline = $null
$script:candidate = $null
if ($SelfTest) {
    Assert-RunnerSelfTest
    return
}
if ([string]::IsNullOrWhiteSpace($BaselineExecutable) -or [string]::IsNullOrWhiteSpace($CandidateExecutable)) {
    throw 'BaselineExecutable and CandidateExecutable are required unless -SelfTest is used.'
}
$baseline = Resolve-Executable $BaselineExecutable 'Baseline'
$candidate = Resolve-Executable $CandidateExecutable 'Candidate'
if ([System.IO.Path]::GetFullPath($baseline) -eq [System.IO.Path]::GetFullPath($candidate)) {
    throw 'Baseline and candidate executables must be distinct retained builds.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Join-Path $PSScriptRoot '..\\src-tauri\\target') ("sql-plugin-ab-evidence-" + [guid]::NewGuid().ToString('N'))
}
if (Test-Path -LiteralPath $OutputDirectory) {
    throw "Refusing to overwrite existing output directory: $OutputDirectory"
}
$evidenceDirectory = New-Item -ItemType Directory -Path $OutputDirectory -ErrorAction Stop
$script:evidenceDirectory = $evidenceDirectory

$runs = [System.Collections.Generic.List[object]]::new()
$script:runs = $runs
try {
    foreach ($executable in @($baseline, $candidate)) {
        $listing = & $executable --list 2>&1
        if ($LASTEXITCODE -ne 0 -or -not ($listing -match '^db::migrations::sql_plugin_tests::sql_plugin_benchmark::benchmark_sql_plugin_connection_candidate: test$')) {
            throw "Benchmark executable preflight failed: $executable (exit $LASTEXITCODE)."
        }
    }
    for ($pair = 1; $pair -le 6; $pair++) {
        $order = if ($pair % 2 -eq 1) { @('baseline', 'candidate') } else { @('candidate', 'baseline') }
        for ($position = 0; $position -lt $order.Count; $position++) {
            $mode = $order[$position]
            $executable = if ($mode -eq 'baseline') { $baseline } else { $candidate }
            $profile = if ($mode -eq 'candidate') { $CandidateProfile } else { 'legacy' }
            $runs.Add((Invoke-BenchmarkRun $executable $mode $profile $pair ($position + 1) $evidenceDirectory.FullName))
        }
    }
}
catch {
    [ordered]@{
        complete = $false
        error = $_.Exception.Message
        completed_runs = @($runs)
        limitations = 'Raw logs are retained for each completed run. This partial matrix must not be presented as an A/B result.'
    } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $evidenceDirectory.FullName 'benchmark-incomplete.json') -Encoding utf8
    throw
}

$expectedCells = @(
    'representative/all-users',
    'representative/selected-owner',
    'representative/non-invoke',
    'small/all-users',
    'small/selected-owner',
    'small/non-invoke'
)
foreach ($run in $runs) {
    $observedCells = @($run.Result.cells | ForEach-Object cell | Sort-Object)
    if (($observedCells -join '|') -ne (($expectedCells | Sort-Object) -join '|')) {
        [ordered]@{
            complete = $false
            error = "Missing or unexpected cells in $($run.Mode) pair $($run.Pair)"
            expected_cells = $expectedCells
            observed_cells = $observedCells
            completed_runs = @($runs)
            limitations = 'Raw logs are retained for each completed run. This partial matrix must not be presented as an A/B result.'
        } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $evidenceDirectory.FullName 'benchmark-incomplete.json') -Encoding utf8
        Stop-IncompleteEvidence "Incomplete benchmark matrix: missing or unexpected cells in $($run.Mode) pair $($run.Pair)."
    }
}

$samples = [System.Collections.Generic.List[object]]::new()
foreach ($run in $runs) {
    foreach ($cell in $run.Result.cells) {
        foreach ($workload in @('sequential', 'concurrent')) {
            $first = $cell.first_ipc_after_expected_rows_ms.$workload
            $warm = $cell.warm_ipc_total_ms.$workload
            foreach ($queryIndex in 0..1) {
                $query = @('collection-count', 'maintenance-count')[$queryIndex]
                Assert-WarmSeries $warm[$queryIndex] "$($run.Mode) pair $($run.Pair) $($cell.cell) $workload $query"
                $samples.Add([pscustomobject]@{
                    Mode = $run.Mode; Pair = $run.Pair; Cell = [string]$cell.cell
                    Stage = 'first-ipc-after-expected-rows'; Workload = $workload; Query = $query
                    Milliseconds = Convert-ValidMilliseconds $first[$queryIndex] "$($run.Mode) pair $($run.Pair) $($cell.cell) first $workload $query"
                })
                foreach ($value in $warm[$queryIndex]) {
                    $samples.Add([pscustomobject]@{
                        Mode = $run.Mode; Pair = $run.Pair; Cell = [string]$cell.cell
                        Stage = 'warm'; Workload = $workload; Query = $query
                        Milliseconds = Convert-ValidMilliseconds $value "$($run.Mode) pair $($run.Pair) $($cell.cell) warm $workload $query"
                    })
                }
            }
        }
    }
}

$perRunMedians = foreach ($group in ($samples | Group-Object { "$($_.Mode)|$($_.Pair)|$($_.Cell)|$($_.Stage)|$($_.Workload)|$($_.Query)" })) {
    $values = @($group.Group | ForEach-Object Milliseconds)
    if ($group.Group[0].Stage -eq 'first-ipc-after-expected-rows' -and $values.Count -ne 1) {
        Stop-IncompleteEvidence "Expected one first-read sample for $($group.Name), received $($values.Count)."
    }
    if ($group.Group[0].Stage -eq 'warm' -and $values.Count -ne 5) {
        Stop-IncompleteEvidence "Expected five warm samples for $($group.Name), received $($values.Count)."
    }
    [pscustomobject]@{
        Mode = $group.Group[0].Mode; Pair = $group.Group[0].Pair; Cell = $group.Group[0].Cell
        Stage = $group.Group[0].Stage; Workload = $group.Group[0].Workload; Query = $group.Group[0].Query
        RawSampleCount = $values.Count; MedianMs = Get-Median $values
    }
}

$regressions = [System.Collections.Generic.List[object]]::new()
$medians = foreach ($group in ($perRunMedians | Group-Object { "$($_.Cell)|$($_.Stage)|$($_.Workload)|$($_.Query)" })) {
    $baselineSamples = @($group.Group | Where-Object Mode -eq 'baseline' | ForEach-Object MedianMs)
    $candidateSamples = @($group.Group | Where-Object Mode -eq 'candidate' | ForEach-Object MedianMs)
    if ($baselineSamples.Count -ne 6 -or $candidateSamples.Count -ne 6) {
        Stop-IncompleteEvidence "Incomplete paired run medians for $($group.Name): baseline=$($baselineSamples.Count), candidate=$($candidateSamples.Count), expected=6 each"
    }
    if ($baselineSamples.Count -ne $candidateSamples.Count) {
        Stop-IncompleteEvidence "Unpaired sample counts for $($group.Name): baseline=$($baselineSamples.Count), candidate=$($candidateSamples.Count)"
    }
    $baselineMedian = Get-Median $baselineSamples
    $candidateMedian = Get-Median $candidateSamples
    $threshold = if ($baselineMedian -lt 200.0) { $baselineMedian + 20.0 } else { $baselineMedian * 1.1 }
    $measurement = [pscustomobject]@{
        Cell = $group.Group[0].Cell; Stage = $group.Group[0].Stage
        Workload = $group.Group[0].Workload; Query = $group.Group[0].Query
        BaselineRunMedians = $baselineSamples.Count; CandidateRunMedians = $candidateSamples.Count
        BaselineMedianMs = $baselineMedian; CandidateMedianMs = $candidateMedian
        RegressionThresholdMs = $threshold; Regressed = $candidateMedian -gt $threshold
    }
    if ($measurement.Regressed) { $regressions.Add($measurement) }
    $measurement
}

if (@($medians).Count -ne 48) {
    Stop-IncompleteEvidence "Expected all 48 cell/stage/workload/query comparisons, received $(@($medians).Count)."
}

$expectedRows = @{}
$candidateRowHashes = @{}
$baselineEmittedRowHashes = $true
foreach ($run in $runs) {
    foreach ($cell in $run.Result.cells) {
        $signature = ($cell.expected_row_counts -join ',')
        if ($expectedRows.ContainsKey($cell.cell) -and $expectedRows[$cell.cell] -ne $signature) {
            Stop-IncompleteEvidence "Generated expected-row count mismatch for $($cell.cell): $($expectedRows[$cell.cell]) versus $signature"
        }
        $expectedRows[$cell.cell] = $signature
        if ($null -eq $cell.expected_row_hashes) {
            if ($run.Mode -eq 'baseline') { $baselineEmittedRowHashes = $false }
            continue
        }
        $hashSignature = ($cell.expected_row_hashes -join ',')
        if ($run.Mode -eq 'candidate') {
            if ($candidateRowHashes.ContainsKey($cell.cell) -and $candidateRowHashes[$cell.cell] -ne $hashSignature) {
                Stop-IncompleteEvidence "Candidate exact expected-row hash mismatch for $($cell.cell): $($candidateRowHashes[$cell.cell]) versus $hashSignature"
            }
            $candidateRowHashes[$cell.cell] = $hashSignature
        }
    }
}

$candidatePragmaFailures = [System.Collections.Generic.List[object]]::new()
foreach ($run in @($runs | Where-Object Mode -eq 'candidate')) {
    foreach ($cell in $run.Result.cells) {
        $snapshots = @($cell.pool_pragmas)
        $slots = @($snapshots | ForEach-Object connection_slot | Sort-Object -Unique)
        if ($snapshots.Count -ne 10 -or $slots.Count -ne 10 -or (($slots -join ',') -ne '0,1,2,3,4,5,6,7,8,9')) {
            $candidatePragmaFailures.Add([pscustomobject]@{ Pair = $run.Pair; Cell = $cell.cell; ConnectionSlot = $null; Pragma = 'connection_slots'; Actual = ($slots -join ','); Expected = '0,1,2,3,4,5,6,7,8,9' })
        }
        $configured = @{ journal_mode = 'wal'; synchronous = 1; busy_timeout = 60000; cache_size = -64000; temp_store = 2; mmap_size = 268435456 }
        $defaults = @{ journal_mode = 'wal'; synchronous = 2; busy_timeout = 5000; cache_size = -2000; temp_store = 0; mmap_size = 0 }
        $configuredCount = 0
        $defaultCount = 0
        foreach ($snapshot in $snapshots) {
            $matchesConfigured = @($configured.Keys | Where-Object { [string]$snapshot.$_ -ne [string]$configured[$_] }).Count -eq 0
            $matchesDefault = @($defaults.Keys | Where-Object { [string]$snapshot.$_ -ne [string]$defaults[$_] }).Count -eq 0
            if ($matchesConfigured) { $configuredCount++ }
            elseif ($matchesDefault) { $defaultCount++ }
            else {
                $candidatePragmaFailures.Add([pscustomobject]@{ Pair = $run.Pair; Cell = $cell.cell; ConnectionSlot = $snapshot.connection_slot; Pragma = 'legacy_profile'; Actual = ($snapshot | ConvertTo-Json -Compress); Expected = 'one fully configured connection or a WAL-preserving default connection' })
            }
        }
        if ($configuredCount -ne 1 -or $defaultCount -ne 9) {
            $candidatePragmaFailures.Add([pscustomobject]@{ Pair = $run.Pair; Cell = $cell.cell; ConnectionSlot = $null; Pragma = 'legacy_distribution'; Actual = "configured=$configuredCount,default=$defaultCount"; Expected = 'configured=1,default=9' })
        }
    }
}

$summary = [ordered]@{
    complete = $true
    acceptance_passed = ($candidatePragmaFailures.Count -eq 0 -and $regressions.Count -eq 0)
    baseline_executable = $baseline
    candidate_executable = $candidate
    candidate_profile = $CandidateProfile
    executable_sha256 = [ordered]@{
        baseline = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash
        candidate = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
    }
    pair_count = 6
    pair_order = 'odd pairs baseline/candidate; even pairs candidate/baseline'
    mode_order_by_pair = @($runs | Sort-Object Pair, Position | ForEach-Object { [pscustomobject]@{ pair = $_.Pair; position = $_.Position; mode = $_.Mode; executable_sha256 = (Get-FileHash -LiteralPath $(if ($_.Mode -eq 'baseline') { $baseline } else { $candidate }) -Algorithm SHA256).Hash } })
    expected_row_counts = $expectedRows
    exact_row_verification = [ordered]@{
        baseline = 'The retained unpatched executable asserts every IPC result equals the direct result of the unchanged reference SQL on its deterministic generated catalog. It predates output-level row hashes and emits no digest.'
        candidate = 'The candidate executable asserts every IPC result equals the same direct reference result and emits stable SHA-256 digests of those generated expected rows.'
        cross_binary = 'Both executables use the same deterministic catalog generator and unchanged reference SQL. This is assertion-based equivalence, not a cross-binary digest comparison.'
        baseline_emitted_row_hashes = $baselineEmittedRowHashes
        candidate_row_hashes = $candidateRowHashes
    }
    raw_samples = $samples
    per_run_medians = $perRunMedians
    medians = $medians
    candidate_pragma_failures = $candidatePragmaFailures
    peak_process_memory = @($runs | ForEach-Object { [pscustomobject]@{ mode = $_.Mode; pair = $_.Pair; memory = $_.Result.peak_process_memory } })
    regressions = $regressions
    logs = @($runs | ForEach-Object Log)
    limitations = 'IPC totals include plugin lookup, registry/pool waiting, query execution and decode. They are not pure SQLite execution or OS-cold startup measurements. Peak process memory is process-wide, not a cache-memory ceiling.'
}
$summaryPath = Join-Path $evidenceDirectory.FullName 'benchmark-summary.json'
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding utf8
if ($candidatePragmaFailures.Count -gt 0) {
    throw "Candidate pool PRAGMA verification failed ($($candidatePragmaFailures.Count) observations). Complete evidence: $summaryPath"
}
if ($regressions.Count -gt 0) {
    throw "Candidate median regression threshold exceeded ($($regressions.Count) measurements). Complete evidence: $summaryPath"
}
Write-Host "SQL plugin A/B benchmark evidence: $summaryPath"
