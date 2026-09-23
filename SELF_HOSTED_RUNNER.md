# Self-hosted runner setup (R4)

Why this exists, and how to stand one up on another machine.

## Why a self-hosted runner at all

Three central banks sit behind WAFs that a GitHub-hosted runner cannot get
past. NBP is the one that actually matters, and it is precise about what it
wants:

| Attempt | Result |
|---|---|
| plain `requests` | 884-byte Incapsula challenge, zero links |
| headless Chromium + stealth | 884-byte challenge |
| headed Chromium, no stealth | 884-byte challenge |
| **headed Chromium + stealth** | the real 283 KB listing |

Both halves are required, and "headed" means a real desktop session. Measured
again on the runner built here: the hosted job discovers **0** NBP statements,
this runner discovers **296**.

## The one thing that is easy to get wrong

**Do not install the runner as a Windows service.** A service runs in session 0,
which has no desktop, so headed Chromium there fails in exactly the way it
fails on a hosted runner — you would end up with a runner that cannot do the
only job it exists for.

Run it **interactively in a logged-in desktop session**, started by a scheduled
task at logon. The machine therefore has to be left logged in (it can be
locked; locking does not destroy the session).

Older revisions of `RUNBOOK.md` said `./svc.sh install && ./svc.sh start`. That
is Linux syntax *and* the wrong model. Ignore it.

---

## Setting one up

Everything below is what was actually run on `premm-desktop`, in order.

### 1. Prerequisites

- Windows 10/11, logged-in user account that stays logged in
- `git`, and `uv` (the workflow resolves `%USERPROFILE%\.local\bin\uv.exe` if
  `uv` is not on PATH)
- A GitHub account with admin on the repo

### 2. Download and unpack

Check the latest version rather than pasting a number that will go stale:

```powershell
# https://github.com/actions/runner/releases/latest
mkdir C:\actions-runner; cd C:\actions-runner
curl -L -o runner.zip https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-win-x64-2.337.0.zip
Expand-Archive -Path runner.zip -DestinationPath . -Force
```

### 3. Register it against the repo

Get a registration token from **Settings → Actions → Runners → New self-hosted
runner** (it expires in an hour), then:

```powershell
cd C:\actions-runner
.\config.cmd --unattended `
  --url https://github.com/pchattani/cb_sentiment_project `
  --token <REGISTRATION_TOKEN> `
  --name "<machine-name>" `
  --labels "waf,windows-desktop" `
  --work "_work" --replace
```

`waf` is the label `waf_update.yml` selects on (`runs-on: [self-hosted, waf]`).
Get it wrong and the job queues forever with no error.

### 4. Allow PowerShell to run the runner's scripts

The runner writes each step to a temporary `.ps1`. With the default execution
policy that is blocked, and the job fails with `PSSecurityException:
UnauthorizedAccess`:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 5. Start it at logon, interactively

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\actions-runner\run.cmd"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
              -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
              -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "GitHubActionsRunner-cbsentiment" `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Interactive, not a service: NBP needs headed Chromium." -Force

Start-ScheduledTask -TaskName "GitHubActionsRunner-cbsentiment"
```

`-ExecutionTimeLimit ([TimeSpan]::Zero)` matters — the default kills the task
after three days.

### 6. Confirm

```powershell
Get-Process Runner.Listener          # should be running
```

and the runner should show **Idle** under Settings → Actions → Runners.

### 7. Secrets

The workflow reads `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and
`DEEPSEEK_API_KEY` from repository secrets. Nothing extra is needed on the
machine — they are delivered to the job.

---

## Writing a workflow that runs here

Four things bit during setup, all of them silent until the job failed:

1. **`shell: powershell`, not `pwsh` or `bash`.** Neither is on the runner's
   PATH. The first run failed instantly with `pwsh: command not found`.
2. **PowerShell 5.1 has no `&&` or `||`.** They are parse errors. Use
   `if ($LASTEXITCODE -ne 0) { ... }`.
3. **Set `$ErrorActionPreference = 'Continue'` in any step that runs git.** The
   runner defaults it to `Stop`, and in 5.1 *any* stderr from a native command
   then becomes a terminating error. git writes progress to stderr, so two runs
   pushed successfully and reported failure anyway. Trust `$LASTEXITCODE`.
4. **Declare `permissions: contents: write`** on any job that pushes, or the
   checkout token is read-only and the push returns 403.

---

## If the runner stops

There is deliberately no runner-liveness alert. If it stops, NBP misses a
scheduled meeting and the calendar-anchored check reports that within the grace
period — the signal that matters is the data, not the infrastructure.

To collect NBP by hand in the meantime:

```powershell
$env:PLAYWRIGHT_HEADLESS = "0"
.venv\Scripts\python.exe scripts/update.py --cb nbp --since 2026-09-01
```

## Removing a runner

```powershell
Stop-ScheduledTask  -TaskName "GitHubActionsRunner-cbsentiment"
Unregister-ScheduledTask -TaskName "GitHubActionsRunner-cbsentiment" -Confirm:$false
cd C:\actions-runner; .\config.cmd remove --token <REMOVAL_TOKEN>
```
