[CmdletBinding()]
param(
  [string]$ServerHost = '139.224.73.167',
  [string]$User = 'root',
  [string]$ProjectRoot = '/opt/Amazon-ASIN-monitor',
  [string]$StaticDir = '/opt/1panel/www/sites/Amazon-ASIN-monitor/index',
  [string]$RemoteTempDir = '/root',
  [string]$HealthHost = '139.224.73.167',
  [string]$CommitLabel = '',
  [string]$Password = '',
  [string]$EnvFilePath = '',
  [string]$PasswordEnvKey = 'DB_PASSWORD',
  [switch]$SkipBuild,
  [switch]$InstallRoot,
  [switch]$InstallServer,
  [switch]$BuildOnHost,
  [switch]$KeepRemoteArchive,
  [switch]$SkipRestart,
  [switch]$SkipHealthCheck,
  [switch]$SkipStaticSync,
  [switch]$AllowMissingContainers
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[INFO] $Message"
}

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = (Get-Location).Path
  )

  Write-Step ("Running: {0} {1}" -f $FilePath, ($Arguments -join ' '))
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
    }
  } finally {
    Pop-Location
  }
}

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) {
    return $null
  }

  $escapedKey = [regex]::Escape($Key)
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*#') {
      continue
    }
    if ($line -match "^\s*$escapedKey\s*=\s*(.*)\s*$") {
      $value = $Matches[1].Trim()
      if ($value.Length -ge 2) {
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
          $value = $value.Substring(1, $value.Length - 2)
        }
      }
      return $value
    }
  }

  return $null
}

function Quote-BashArg {
  param([string]$Value)
  if ($null -eq $Value -or $Value.Length -eq 0) {
    return "''"
  }
  $singleQuote = [string][char]39
  $doubleQuote = [string][char]34
  $escapedSingleQuote = $singleQuote + $doubleQuote + $singleQuote + $doubleQuote + $singleQuote
  return $singleQuote + ($Value.Replace($singleQuote, $escapedSingleQuote)) + $singleQuote
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PythonDeployHelper = Join-Path $PSScriptRoot 'deploy-1panel.py'
$DeployDir = Join-Path $RepoRoot '.tmp\deploy'
$null = New-Item -ItemType Directory -Path $DeployDir -Force

if ([string]::IsNullOrWhiteSpace($EnvFilePath)) {
  $EnvFilePath = Join-Path $RepoRoot 'server\.env'
}

if (-not (Test-Path $PythonDeployHelper)) {
  throw "Missing helper script: $PythonDeployHelper"
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  $Password = Get-DotEnvValue -Path $EnvFilePath -Key $PasswordEnvKey
  if (-not [string]::IsNullOrWhiteSpace($Password)) {
    Write-Step "Loaded SSH password from $EnvFilePath ($PasswordEnvKey)"
  } else {
    Write-Step 'No SSH password found in env file, Python deploy helper will try SSH agent/key auth'
  }
}

if ([string]::IsNullOrWhiteSpace($CommitLabel)) {
  try {
    $CommitLabel = (& git -C $RepoRoot rev-parse --short HEAD).Trim()
  } catch {
    $CommitLabel = 'manual'
  }
}

if (-not $SkipBuild -and -not $BuildOnHost) {
  Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'build') -WorkingDirectory $RepoRoot
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archiveName = "amazon-asin-monitor-deploy-$timestamp.tar.gz"
$archivePath = Join-Path $DeployDir $archiveName

if (Test-Path $archivePath) {
  Remove-Item $archivePath -Force
}

$tarArgs = @(
  '--exclude=.git',
  '--exclude=.specstory',
  '--exclude=.tmp',
  '--exclude=.idea',
  '--exclude=.vscode',
  '--exclude=node_modules',
  '--exclude=server/node_modules',
  '--exclude=server/.pnpm-store',
  '--exclude=backups',
  '--exclude=server/backups',
  '--exclude=server/.env',
  '--exclude=server/.env.worker',
  '--exclude=server/.env.public-api',
  '--exclude=server/.env.scheduler-api',
  '--exclude=.env',
  '-czf',
  $archivePath,
  '-C',
  $RepoRoot,
  '.'
)

Invoke-CheckedCommand -FilePath 'tar.exe' -Arguments $tarArgs

$remoteArchivePath = "$RemoteTempDir/$archiveName"
$remoteDeployScript = "$RemoteTempDir/amazon-asin-monitor-deploy.sh"
$localDeployScript = Join-Path $RepoRoot 'deploy.sh'

$remoteArgs = @(
  'bash',
  $remoteDeployScript,
  '--archive', $remoteArchivePath,
  '--project-root', $ProjectRoot,
  '--static-dir', $StaticDir,
  '--health-host', $HealthHost,
  '--commit-label', $CommitLabel
)

if ($InstallRoot) {
  $remoteArgs += '--install-root'
}
if ($InstallServer) {
  $remoteArgs += '--install-server'
}
if ($BuildOnHost) {
  $remoteArgs += '--build'
}
if ($KeepRemoteArchive) {
  $remoteArgs += '--keep-archive'
}
if ($SkipRestart) {
  $remoteArgs += '--skip-restart'
}
if ($SkipHealthCheck) {
  $remoteArgs += '--skip-health-check'
}
if ($SkipStaticSync) {
  $remoteArgs += '--skip-static-sync'
}
if ($AllowMissingContainers) {
  $remoteArgs += '--allow-missing-containers'
}

$quotedRemoteArgs = ($remoteArgs | ForEach-Object { Quote-BashArg $_ }) -join ' '
$remoteCommand = "$quotedRemoteArgs; status=`$?; rm -f $(Quote-BashArg $remoteDeployScript); exit `$status"

$previousDeployHost = $env:DEPLOY_SERVER_HOST
$previousDeployUser = $env:DEPLOY_SERVER_USER
$previousDeployPassword = $env:DEPLOY_SSH_PASSWORD
$previousDeployArchive = $env:DEPLOY_LOCAL_ARCHIVE
$previousDeployScript = $env:DEPLOY_LOCAL_SCRIPT
$previousRemoteArchive = $env:DEPLOY_REMOTE_ARCHIVE
$previousRemoteScript = $env:DEPLOY_REMOTE_SCRIPT
$previousRemoteCommand = $env:DEPLOY_REMOTE_COMMAND

try {
  $env:DEPLOY_SERVER_HOST = $ServerHost
  $env:DEPLOY_SERVER_USER = $User
  $env:DEPLOY_SSH_PASSWORD = $Password
  $env:DEPLOY_LOCAL_ARCHIVE = $archivePath
  $env:DEPLOY_LOCAL_SCRIPT = $localDeployScript
  $env:DEPLOY_REMOTE_ARCHIVE = $remoteArchivePath
  $env:DEPLOY_REMOTE_SCRIPT = $remoteDeployScript
  $env:DEPLOY_REMOTE_COMMAND = $remoteCommand

  Invoke-CheckedCommand -FilePath 'python' -Arguments @($PythonDeployHelper)
} finally {
  $env:DEPLOY_SERVER_HOST = $previousDeployHost
  $env:DEPLOY_SERVER_USER = $previousDeployUser
  $env:DEPLOY_SSH_PASSWORD = $previousDeployPassword
  $env:DEPLOY_LOCAL_ARCHIVE = $previousDeployArchive
  $env:DEPLOY_LOCAL_SCRIPT = $previousDeployScript
  $env:DEPLOY_REMOTE_ARCHIVE = $previousRemoteArchive
  $env:DEPLOY_REMOTE_SCRIPT = $previousRemoteScript
  $env:DEPLOY_REMOTE_COMMAND = $previousRemoteCommand
}

Write-Step "Deployment finished. Archive: $archivePath"
