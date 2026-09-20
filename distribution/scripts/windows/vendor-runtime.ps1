$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
  throw '[Vendor] Windows vendor-runtime.ps1 must run on Windows.'
}

$NativeArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
  $env:PROCESSOR_ARCHITEW6432
} else {
  $env:PROCESSOR_ARCHITECTURE
}

if ($NativeArchitecture -ne 'AMD64') {
  throw "[Vendor] Windows release build requires native AMD64, got $NativeArchitecture."
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Target = 'win32-x64'
$LockPath = Join-Path $Root 'distribution\runtime-lock.json'
$Lock = Get-Content $LockPath -Raw | ConvertFrom-Json
$TargetState = $Lock.cacheRuntime.targets.$Target

if ($TargetState.status -ne 'supported') {
  throw "[Vendor] $Target cache runtime is not enabled in runtime-lock.json."
}

$Vendor = Join-Path $Root "distribution\vendor\$Target"
$Cache = Join-Path $Root "distribution\.cache\$Target"
$Runtime = Join-Path $Vendor 'resources\runtime'
$Licenses = Join-Path $Vendor 'licenses'

New-Item -ItemType Directory -Force -Path $Cache, $Runtime, $Licenses | Out-Null

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[Vendor] Required Windows build command is missing: $Name"
  }
}

foreach ($Command in @(
  'git',
  'cl',
  'nmake',
  'dotnet',
  'curl.exe',
  'tar.exe'
)) {
  Assert-Command $Command
}

$DotnetSdks = (& dotnet --list-sdks) -join "`n"

if ($LASTEXITCODE -ne 0 -or $DotnetSdks -notmatch '(?m)^10\.') {
  throw '[Vendor] .NET 10 SDK is required to publish Garnet self-contained for win-x64.'
}

function Invoke-CurlDownload(
  [string]$Url,
  [string]$Output,
  [bool]$Resume
) {
  $Arguments = @(
    '--http1.1',
    '--fail',
    '--location',
    '--retry', '5',
    '--retry-all-errors',
    '--retry-delay', '2',
    '--connect-timeout', '30',
    '--show-error',
    '--output', $Output
  )

  if ($Resume) {
    $Arguments += @('--continue-at', '-')
  }

  $Arguments += $Url

  & curl.exe @Arguments
  return $LASTEXITCODE
}

function Get-VerifiedDownload(
  [string]$Url,
  [string]$Output,
  [string]$Sha256
) {
  $Parent = Split-Path $Output -Parent
  New-Item -ItemType Directory -Force -Path $Parent | Out-Null

  $Expected = $Sha256.ToLowerInvariant()

  if (Test-Path $Output -PathType Leaf) {
    $Existing = (Get-FileHash -Algorithm SHA256 $Output).Hash.ToLowerInvariant()

    if ($Existing -eq $Expected) {
      Write-Host "[Vendor] Cache hit: $(Split-Path $Output -Leaf)"
      return
    }

    Write-Warning "[Vendor] Cached file failed checksum and will be replaced: $Output"
    Remove-Item -Force $Output
  }

  $Part = "$Output.part"

  if (Test-Path $Part -PathType Leaf) {
    Write-Host "[Vendor] Resuming download: $(Split-Path $Output -Leaf)"
    $ExitCode = Invoke-CurlDownload $Url $Part $true

    if ($ExitCode -ne 0) {
      Write-Warning "[Vendor] Resume failed; restarting download from zero: $(Split-Path $Output -Leaf)"
      Remove-Item -Force -ErrorAction SilentlyContinue $Part
      $ExitCode = Invoke-CurlDownload $Url $Part $false
    }
  }
  else {
    Write-Host "[Vendor] Downloading: $Url"
    $ExitCode = Invoke-CurlDownload $Url $Part $false
  }

  if ($ExitCode -ne 0) {
    throw "[Vendor] Download failed: $Url"
  }

  $Actual = (Get-FileHash -Algorithm SHA256 $Part).Hash.ToLowerInvariant()

  if ($Actual -ne $Expected) {
    Remove-Item -Force -ErrorAction SilentlyContinue $Part
    throw "[Vendor] SHA256 mismatch for $Url. Expected $Sha256, got $Actual."
  }

  Move-Item -Force $Part $Output
  Write-Host "[Vendor] Download verified: $(Split-Path $Output -Leaf)"
}

function Get-RepositoryCommit([string]$Destination) {
  if (-not (Test-Path (Join-Path $Destination '.git') -PathType Container)) {
    return ''
  }

  $Commit = (& git -C $Destination rev-parse HEAD 2>$null)

  if ($LASTEXITCODE -ne 0 -or -not $Commit) {
    return ''
  }

  return $Commit.Trim().ToLowerInvariant()
}

function Clone-PinnedRepository(
  [string]$Repository,
  [string]$Tag,
  [string]$Destination,
  [string]$ExpectedCommit = ''
) {
  $Expected = $ExpectedCommit.ToLowerInvariant()
  $CachedCommit = Get-RepositoryCommit $Destination

  if (
    $CachedCommit -and
    $CachedCommit -match '^[a-f0-9]{40}$' -and
    (-not $Expected -or $CachedCommit -eq $Expected)
  ) {
    Write-Host "[Vendor] Repository cache hit: $Repository @ $CachedCommit"

    & git -C $Destination reset --hard HEAD --quiet
    if ($LASTEXITCODE -ne 0) {
      throw "[Vendor] Failed to reset cached repository: $Destination"
    }

    & git -C $Destination clean -ffdx --quiet
    if ($LASTEXITCODE -ne 0) {
      throw "[Vendor] Failed to clean cached repository: $Destination"
    }

    return $CachedCommit
  }

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination

  for ($Attempt = 1; $Attempt -le 5; $Attempt += 1) {
    Write-Host "[Vendor] Cloning $Repository $Tag (attempt $Attempt/5)"

    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination

    & git `
      -c http.version=HTTP/1.1 `
      clone `
      --quiet `
      --depth 1 `
      --branch $Tag `
      $Repository `
      $Destination

    if ($LASTEXITCODE -eq 0) {
      $Commit = Get-RepositoryCommit $Destination

      if (-not $Commit -or $Commit -notmatch '^[a-f0-9]{40}$') {
        throw "[Vendor] Could not resolve pinned commit for $Repository."
      }

      if ($Expected -and $Commit -ne $Expected) {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination
        throw "[Vendor] Repository commit mismatch for $Repository. Expected $ExpectedCommit, got $Commit."
      }

      Write-Host "[Vendor] Repository verified: $Repository @ $Commit"
      return $Commit
    }

    if ($Attempt -lt 5) {
      $DelaySeconds = $Attempt * 2
      Write-Warning "[Vendor] Clone failed; retrying in $DelaySeconds seconds: $Repository"
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination
  throw "[Vendor] git clone failed after 5 attempts: $Repository $Tag"
}

function Copy-VcRuntime([string]$Destination) {
  $Roots = @()

  if ($env:VCToolsRedistDir) {
    $Roots += $env:VCToolsRedistDir
  }

  if ($env:VCINSTALLDIR) {
    $Roots += (Join-Path $env:VCINSTALLDIR 'Redist\MSVC')
  }

  foreach ($RootCandidate in $Roots) {
    if (-not (Test-Path $RootCandidate)) {
      continue
    }

    $Crt = Get-ChildItem `
      -Path $RootCandidate `
      -Directory `
      -Recurse `
      -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match '^Microsoft\.VC\d+\.CRT$' -and
        $_.FullName -match '\\x64\\'
      } |
      Select-Object -First 1

    if ($Crt) {
      $Dlls = Get-ChildItem `
        -Path $Crt.FullName `
        -Filter '*.dll' `
        -File `
        -ErrorAction SilentlyContinue

      if (-not $Dlls) {
        continue
      }

      Copy-Item `
        -Force `
        $Dlls.FullName `
        $Destination

      Write-Host "[Vendor] Bundled Visual C++ runtime from $($Crt.FullName)"
      return
    }
  }

  throw '[Vendor] Visual C++ x64 redistributable runtime directory was not found. Run from an x64 Visual Studio Build Tools environment.'
}

function Copy-PostgresLicense(
  [object]$PostgresTarget,
  [string]$PostgresRuntime,
  [string]$Cache,
  [string]$Licenses
) {
  $Destination = Join-Path $Licenses 'postgresql.txt'

  $RuntimeCopyright = Get-ChildItem `
    $PostgresRuntime `
    -Filter 'COPYRIGHT' `
    -File `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($RuntimeCopyright) {
    Copy-Item $RuntimeCopyright.FullName $Destination
    Write-Host '[Vendor] PostgreSQL license collected from portable runtime archive.'
    return
  }

  if (-not ($PostgresTarget.PSObject.Properties.Name -contains 'licenseSource')) {
    throw '[Vendor] PostgreSQL Windows target has no licenseSource fallback in runtime-lock.json.'
  }

  $LicenseSource = $PostgresTarget.licenseSource

  foreach ($Property in @('archive', 'url', 'sha256')) {
    if (-not ($LicenseSource.PSObject.Properties.Name -contains $Property)) {
      throw "[Vendor] PostgreSQL Windows licenseSource is missing $Property."
    }
  }

  if (
    -not $LicenseSource.archive -or
    -not $LicenseSource.url -or
    -not $LicenseSource.sha256
  ) {
    throw '[Vendor] PostgreSQL Windows licenseSource must define archive, url and sha256.'
  }

  $LicenseArchive = Join-Path $Cache $LicenseSource.archive

  Get-VerifiedDownload `
    $LicenseSource.url `
    $LicenseArchive `
    $LicenseSource.sha256

  $Entries = @(& tar.exe -tf $LicenseArchive)

  if ($LASTEXITCODE -ne 0) {
    throw '[Vendor] Failed to inspect PostgreSQL Windows license source archive.'
  }

  $CopyrightEntry = $Entries |
    Where-Object { $_ -match '(^|/)COPYRIGHT$' } |
    Select-Object -First 1

  if (-not $CopyrightEntry) {
    throw '[Vendor] PostgreSQL Windows license source archive did not contain COPYRIGHT.'
  }

  $ExtractRoot = Join-Path $Cache 'postgresql-license-extract'
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ExtractRoot
  New-Item -ItemType Directory -Force -Path $ExtractRoot | Out-Null

  try {
    & tar.exe `
      -xf `
      $LicenseArchive `
      -C `
      $ExtractRoot `
      $CopyrightEntry

    if ($LASTEXITCODE -ne 0) {
      throw '[Vendor] Failed to extract PostgreSQL COPYRIGHT from Windows license source archive.'
    }

    $RelativeCopyrightPath = $CopyrightEntry.Replace(
      '/',
      [string][System.IO.Path]::DirectorySeparatorChar
    )

    $ExtractedCopyright = Join-Path `
      $ExtractRoot `
      $RelativeCopyrightPath

    if (-not (Test-Path $ExtractedCopyright -PathType Leaf)) {
      throw '[Vendor] Extracted PostgreSQL COPYRIGHT file is missing.'
    }

    Copy-Item $ExtractedCopyright $Destination
    Write-Host '[Vendor] PostgreSQL license collected from Windows-specific pinned official source archive.'
  }
  finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ExtractRoot
  }
}

$NodeTarget = $Lock.node.targets.$Target
$NodeArchive = Join-Path $Cache $NodeTarget.archive

$PostgresTarget = $Lock.postgresql.targets.$Target
$PostgresArchive = Join-Path $Cache $PostgresTarget.archive

Remove-Item `
  -Recurse `
  -Force `
  -ErrorAction SilentlyContinue `
  (Join-Path $Runtime 'node'), `
  (Join-Path $Runtime 'postgres'), `
  (Join-Path $Runtime 'cache')

#
# Node 24.19.0 win-x64
#

Get-VerifiedDownload `
  $NodeTarget.url `
  $NodeArchive `
  $NodeTarget.sha256

$NodeExtractRoot = Join-Path $Cache 'node-extract'

Remove-Item `
  -Recurse `
  -Force `
  -ErrorAction SilentlyContinue `
  $NodeExtractRoot

Expand-Archive `
  -Path $NodeArchive `
  -DestinationPath $NodeExtractRoot `
  -Force

$NodeSourceRoot = Get-ChildItem `
  $NodeExtractRoot `
  -Directory |
  Select-Object -First 1

if (-not $NodeSourceRoot) {
  throw '[Vendor] Node archive did not contain a root directory.'
}

Move-Item `
  $NodeSourceRoot.FullName `
  (Join-Path $Runtime 'node')

Remove-Item `
  -Recurse `
  -Force `
  $NodeExtractRoot

Copy-Item `
  (Join-Path $Runtime 'node\LICENSE') `
  (Join-Path $Licenses 'node.txt')

#
# PostgreSQL 18.4 portable Windows x64 binaries published by EDB.
# The runtime artifact remains Windows-target-specific and SHA256-pinned.
# macOS continues to use postgresql.source unchanged.
#

Get-VerifiedDownload `
  $PostgresTarget.url `
  $PostgresArchive `
  $PostgresTarget.sha256

$PostgresExtractRoot = Join-Path $Cache 'postgresql-extract'

Remove-Item `
  -Recurse `
  -Force `
  -ErrorAction SilentlyContinue `
  $PostgresExtractRoot

Expand-Archive `
  -Path $PostgresArchive `
  -DestinationPath $PostgresExtractRoot `
  -Force

$PostgresSourceRoot = Join-Path $PostgresExtractRoot 'pgsql'

if (-not (Test-Path $PostgresSourceRoot -PathType Container)) {
  $Candidate = Get-ChildItem `
    $PostgresExtractRoot `
    -Directory |
    Select-Object -First 1

  if (-not $Candidate) {
    throw '[Vendor] PostgreSQL binary archive did not contain a runtime root directory.'
  }

  $PostgresSourceRoot = $Candidate.FullName
}

$PostgresRuntime = Join-Path $Runtime 'postgres'

Move-Item `
  $PostgresSourceRoot `
  $PostgresRuntime

Remove-Item `
  -Recurse `
  -Force `
  $PostgresExtractRoot

Copy-PostgresLicense `
  $PostgresTarget `
  $PostgresRuntime `
  $Cache `
  $Licenses

#
# The release runner already has Visual Studio Build Tools for pgvector.
# Bundle the x64 VC runtime beside PostgreSQL so the installed app does not
# depend on a machine-wide Visual C++ Redistributable installation.
#

Copy-VcRuntime (Join-Path $PostgresRuntime 'bin')

#
# pgvector 0.8.6 against the bundled PostgreSQL 18.4 x64 runtime.
#

$PgvectorSource = Join-Path $Cache 'pgvector'

$PgvectorCommit = Clone-PinnedRepository `
  $Lock.pgvector.repository `
  $Lock.pgvector.tag `
  $PgvectorSource `
  $Lock.pgvector.commit

Copy-Item `
  (Join-Path $PgvectorSource 'LICENSE') `
  (Join-Path $Licenses 'pgvector.txt')

$PreviousPgRoot = $env:PGROOT

try {
  $env:PGROOT = $PostgresRuntime

  Push-Location $PgvectorSource

  try {
    & nmake /F Makefile.win clean

    & nmake /F Makefile.win

    if ($LASTEXITCODE -ne 0) {
      throw '[Vendor] pgvector build failed.'
    }

    & nmake /F Makefile.win install

    if ($LASTEXITCODE -ne 0) {
      throw '[Vendor] pgvector install failed.'
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  $env:PGROOT = $PreviousPgRoot
}

#
# Garnet 2.1.4, source-pinned and published self-contained for win-x64.
#

$GarnetSource = Join-Path $Cache 'garnet'

$GarnetCommit = Clone-PinnedRepository `
  $TargetState.repository `
  $TargetState.tag `
  $GarnetSource `
  $TargetState.commit

$GarnetRuntime = Join-Path $Runtime 'cache'

New-Item `
  -ItemType Directory `
  -Force `
  -Path $GarnetRuntime |
  Out-Null

$GarnetProject = Join-Path `
  $GarnetSource `
  'main\GarnetServer\GarnetServer.csproj'

& dotnet publish `
  $GarnetProject `
  '-c' 'Release' `
  '-r' $TargetState.runtimeIdentifier `
  '-f' $TargetState.framework `
  '--self-contained' 'true' `
  '-o' $GarnetRuntime `
  '-p:PublishSingleFile=false' `
  '-p:PublishReadyToRun=false' `
  '-p:EnableSourceLink=false' `
  '-p:EnableSourceControlManagerQueries=false'

if ($LASTEXITCODE -ne 0) {
  throw '[Vendor] Garnet self-contained publish failed.'
}

Copy-Item `
  (Join-Path $GarnetSource 'LICENSE') `
  (Join-Path $Licenses 'garnet.txt')

#
# Required runtime payload
#

$RequiredFiles = @(
  (Join-Path $Runtime 'node\node.exe'),
  (Join-Path $Runtime 'node\npm.cmd'),
  (Join-Path $Runtime 'node\npx.cmd'),
  (Join-Path $Runtime 'node\corepack.cmd'),
  (Join-Path $Runtime 'postgres\bin\postgres.exe'),
  (Join-Path $Runtime 'postgres\bin\initdb.exe'),
  (Join-Path $Runtime 'postgres\bin\pg_ctl.exe'),
  (Join-Path $Runtime 'postgres\bin\pg_isready.exe'),
  (Join-Path $Runtime 'postgres\bin\psql.exe'),
  (Join-Path $Runtime 'postgres\bin\createdb.exe'),
  (Join-Path $Runtime 'postgres\share\extension\vector.control'),
  (Join-Path $Runtime 'postgres\lib\vector.dll'),
  (Join-Path $Runtime 'cache\GarnetServer.exe')
)

foreach ($File in $RequiredFiles) {
  if (-not (Test-Path $File -PathType Leaf)) {
    throw "[Vendor] Required runtime file is missing: $File"
  }
}

foreach ($License in @(
  'node.txt',
  'postgresql.txt',
  'pgvector.txt',
  'garnet.txt'
)) {
  $LicensePath = Join-Path $Licenses $License

  if (
    -not (Test-Path $LicensePath -PathType Leaf) -or
    (Get-Item $LicensePath).Length -eq 0
  ) {
    throw "[Vendor] Required runtime license is missing: $LicensePath"
  }
}

#
# Vendor manifest
#
# IMPORTANT:
# Windows PowerShell 5.1 writes a UTF-8 BOM when using:
#
#   Set-Content -Encoding UTF8
#
# stage.cjs reads this file using Node.js fs.readFile(..., 'utf8') and
# JSON.parse(), so write UTF-8 explicitly without BOM for compatibility
# across Windows PowerShell 5.1 and PowerShell 7+.
#

$Manifest = [ordered]@{
  schemaVersion = 2
  target = $Target
  node = $Lock.node.version
  postgresql = $Lock.postgresql.version
  pgvector = $Lock.pgvector.version
  pgvectorCommit = $PgvectorCommit
  cacheProvider = $TargetState.provider
  cacheVersion = $TargetState.version
  cacheCommit = $GarnetCommit
  cacheSelfContained = $true
}

$ManifestPath = Join-Path $Vendor 'vendor-manifest.json'
$ManifestJson = $Manifest | ConvertTo-Json -Depth 6
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText(
  $ManifestPath,
  "$ManifestJson`n",
  $Utf8NoBom
)

#
# Final runtime version smoke
#

$ManagedNodePath = Join-Path $Runtime 'node'
$env:Path = "$ManagedNodePath;$env:Path"

& (Join-Path $ManagedNodePath 'node.exe') --version
if ($LASTEXITCODE -ne 0) {
  throw '[Vendor] Managed Node runtime smoke failed.'
}

& (Join-Path $ManagedNodePath 'npm.cmd') --version
if ($LASTEXITCODE -ne 0) {
  throw '[Vendor] Managed npm runtime smoke failed.'
}

& (Join-Path $ManagedNodePath 'npx.cmd') --version
if ($LASTEXITCODE -ne 0) {
  throw '[Vendor] Managed npx runtime smoke failed.'
}

& (Join-Path $ManagedNodePath 'corepack.cmd') --version
if ($LASTEXITCODE -ne 0) {
  throw '[Vendor] Managed Corepack runtime smoke failed.'
}

& (Join-Path $Runtime 'postgres\bin\postgres.exe') --version
if ($LASTEXITCODE -ne 0) {
  throw '[Vendor] Managed PostgreSQL runtime smoke failed.'
}

Write-Host "[Vendor] Verified Windows runtime vendor payload: $Vendor"
