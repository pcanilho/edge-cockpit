# Packs the built exe as an MSIX for the Microsoft Store (unsigned: the Store signs it).
# With -Test it also signs a copy with a throwaway certificate, installs it, starts the
# app from the package and removes it again.
param(
  [Parameter(Mandatory)] [string] $Exe,
  [Parameter(Mandatory)] [string] $Version,
  [Parameter(Mandatory)] [string] $Out,
  # The identity Partner Center shows for the reserved name; placeholders until then.
  [string] $Name = 'pcanilho.EdgeCockpit',
  [string] $Publisher = 'CN=pcanilho',
  [string] $PublisherName = 'pcanilho',
  [switch] $Test
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$src = Join-Path $PSScriptRoot '../../app/src-tauri/msix'
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $sdk) { throw 'Windows SDK not found' }
$bin = $sdk.DirectoryName
Write-Host "Windows SDK tools: $bin"

# The Store wants four numbers, the last one 0: 0.11.4 -> 0.11.4.0.
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version $Version is not x.y.z" }
$v4 = "$Version.0"

$layout = Join-Path ([IO.Path]::GetTempPath()) "msix-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $layout, $Out | Out-Null
Copy-Item $Exe (Join-Path $layout 'edge-cockpit.exe')
Copy-Item (Join-Path $src 'Assets') $layout -Recurse
$esc = { param($s) [Security.SecurityElement]::Escape($s) }
(Get-Content (Join-Path $src 'AppxManifest.xml') -Raw) `
  -replace '\{\{NAME\}\}', (& $esc $Name) `
  -replace '\{\{PUBLISHER\}\}', (& $esc $Publisher) `
  -replace '\{\{PUBLISHER_NAME\}\}', (& $esc $PublisherName) `
  -replace '\{\{VERSION\}\}', $v4 |
  Set-Content (Join-Path $layout 'AppxManifest.xml') -Encoding utf8

# resources.pri picks the right logo size for each scale.
$pri = Join-Path ([IO.Path]::GetTempPath()) "priconfig-$([guid]::NewGuid()).xml"
& "$bin\makepri.exe" createconfig /cf $pri /dq en-US /pv 10.0.0 /o | Out-Host
if ($LASTEXITCODE) { throw 'makepri createconfig failed' }
& "$bin\makepri.exe" new /pr $layout /cf $pri /mn (Join-Path $layout 'AppxManifest.xml') /of (Join-Path $layout 'resources.pri') /o | Out-Host
if ($LASTEXITCODE) { throw 'makepri new failed' }

$msix = Join-Path $Out "Edge-Cockpit-$Version.msix"
& "$bin\makeappx.exe" pack /o /h SHA256 /d $layout /p $msix | Out-Host
if ($LASTEXITCODE) { throw 'makeappx pack failed' }
Write-Host "Packed $msix"

if (-not $Test) { return }

# Install test: Windows only installs signed packages, so sign a copy with a certificate
# made for this run and trusted on this runner only.
$cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature `
  -FriendlyName 'Edge Cockpit MSIX test' -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$cer = Join-Path ([IO.Path]::GetTempPath()) 'msix-test.cer'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
$signed = Join-Path ([IO.Path]::GetTempPath()) 'edge-cockpit-test.msix'
Copy-Item $msix $signed
& "$bin\signtool.exe" sign /fd SHA256 /sha1 $cert.Thumbprint /s My $signed | Out-Host
if ($LASTEXITCODE) { throw 'signtool failed' }

Add-AppxPackage -Path $signed
try {
  $pkg = Get-AppxPackage -Name $Name
  if (-not $pkg) { throw 'Package did not install' }
  Write-Host "Installed $($pkg.PackageFullName)"
  Start-Process "shell:AppsFolder\$($pkg.PackageFamilyName)!EdgeCockpit"
  Start-Sleep -Seconds 15
  $proc = Get-Process edge-cockpit -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$($pkg.InstallLocation)*" }
  if (-not $proc) { throw 'The app did not start from the package, or quit right away' }
  Write-Host "Running from the package: $($proc[0].Path)"
  $proc | Stop-Process -Force
} finally {
  Get-AppxPackage -Name $Name | Remove-AppxPackage
  Remove-Item "Cert:\LocalMachine\TrustedPeople\$($cert.Thumbprint)", "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
}
