# A Windows build machine's whole life. machines.sh renders this run's values in and hands
# it over as the machine's custom data; vm.json's script extension starts it as SYSTEM.
# It gets the machine ready, starts exactly one job through a just-in-time runner, and
# deletes the machine afterwards.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$jit = '__JIT__'
$runnerUrl = '__RUNNER_URL__'
$runId = '__RUN_ID__'
$repo = '__REPO__'
$lifetime = [int]'__LIFETIME__'

$r = 'C:\r'
New-Item -ItemType Directory -Force $r | Out-Null
Start-Transcript "$r\boot.log" | Out-Null
$t0 = Get-Date
function Mark($what) { Write-Output ("{0,6:n1}s {1}" -f ((Get-Date) - $t0).TotalSeconds, $what) }

# The machine deletes itself, with the identity that may delete only in nib-ci: when
# the job is done, and at the end of its lifetime whatever else happened.
@'
$h = @{ Metadata = 'true' }
$id = Invoke-RestMethod -Headers $h 'http://169.254.169.254/metadata/instance/compute/resourceId?api-version=2021-02-01&format=text'
$token = (Invoke-RestMethod -Headers $h 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/').access_token
Invoke-RestMethod -Method Delete -Headers @{ Authorization = "Bearer $token" } "https://management.azure.com$($id)?api-version=2024-07-01&forceDeletion=true"
'@ | Set-Content "$r\reap.ps1"
$ps = 'powershell.exe'
Register-ScheduledTask -TaskName nib-reap -User SYSTEM -RunLevel Highest -Force `
  -Action (New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File $r\reap.ps1") `
  -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($lifetime)) | Out-Null
Mark 'watchdog set'

# Speed: no scanning of every file a build writes, and paths past 260 characters.
Set-MpPreference -DisableRealtimeMonitoring $true -DisableBehaviorMonitoring $true -DisableIOAVProtection $true
Add-MpPreference -ExclusionPath 'C:\'
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' LongPathsEnabled 1
Mark 'defender off'

# What the image lacks, side by side with the runner's own download: Python (pack.py)
# and Ninja. Only what a Chromium build of x64 needs: an arm64 build would wait eleven
# minutes for MSVC's arm64 compiler and LLVM, and an installer for .NET 3.5 (WiX),
# longer than either job takes on GitHub's own runners.
$jobs = @()
$jobs += Start-Job {
  curl.exe -sSfL -o C:\r\python.exe https://www.python.org/ftp/python/3.13.7/python-3.13.7-amd64.exe
  Start-Process C:\r\python.exe -Wait -ArgumentList '/quiet InstallAllUsers=1 TargetDir=C:\Python Include_test=0 Include_doc=0 Include_tcltk=0 Include_launcher=0'
  'python installed'
}
$jobs += Start-Job {
  # The engine's C++ wrapper is configured by CMake for Ninja.
  curl.exe -sSfL -o C:\r\ninja.zip https://github.com/ninja-build/ninja/releases/download/v1.13.1/ninja-win.zip
  New-Item -ItemType Directory -Force C:\ninja | Out-Null
  tar.exe -xf C:\r\ninja.zip -C C:\ninja
  'ninja installed: ' + (Test-Path C:\ninja\ninja.exe)
}
curl.exe -sSfL -o "$r\runner.zip" $runnerUrl
tar.exe -xf "$r\runner.zip" -C $r
Mark 'runner unpacked'

# The runner takes one job: the one of the run that made this machine. A job of any
# other run, which only somebody who learned the label could send, never starts.
@"
if (`$env:GITHUB_RUN_ID -ne '$runId' -or `$env:GITHUB_REPOSITORY -ne '$repo') {
  Write-Output "::error::this machine is for run $runId of $repo"
  exit 1
}
"@ | Set-Content "$r\hook.ps1"
"ACTIONS_RUNNER_HOOK_JOB_STARTED=$r\hook.ps1" | Set-Content "$r\.env"

# The job itself. Git's bash goes ahead of the one in System32,
# which is WSL's and has no distribution.
@"
`$env:Path = 'C:\Program Files\Git\bin;C:\Python;C:\Python\Scripts;C:\ninja;' + `$env:Path
& '$r\run.cmd' --jitconfig '$jit' *> '$r\runner.log'
& $ps -NoProfile -ExecutionPolicy Bypass -File '$r\reap.ps1'
"@ | Set-Content "$r\job.ps1"

# As SYSTEM: the image's policy does not let the task scheduler keep a user's password,
# and nothing on this machine is anybody's but the job's. Started before the tools are
# in: a job's first minutes (checkout, Node, Rust, packages) need none of them, and it
# waits for C:\r\ready before the step that does (release.yml, "The machine's tools").
Register-ScheduledTask -TaskName nib-runner -User SYSTEM -RunLevel Highest -Force `
  -Action (New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File $r\job.ps1") `
  -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes $lifetime)) | Out-Null
Start-ScheduledTask -TaskName nib-runner
Mark 'runner started'

$jobs | Wait-Job | Receive-Job
Mark 'tools installed'
Stop-Transcript | Out-Null
Copy-Item "$r\boot.log" "$r\ready"
