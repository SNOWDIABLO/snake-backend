# smoke-test-rewards.ps1
# Valide :
#  1. Reward divisor correct par jeu (GAME_REWARD_DIVISORS)
#  2. Anti-cheat per-game ne rejette pas des scores legitimes
# Pas besoin de wallet/signature -- teste seulement session/start + session/end.

$ErrorActionPreference = 'Stop'
$API = "https://snake-backend-production-e5e8.up.railway.app"

# Wallet de test bidon (adresse valide mais pas utilisee en prod)
$TEST_ADDR = "0x1111111111111111111111111111111111111111"

# Matrice attendue : { game, score, durationSec, expectedReward }
# durationSec : pause avant session/end pour respecter MIN_SESSION_SEC=3
# score choisi pour : (score/duration) < MAX_PTS_PER_SEC_BY_GAME[game]
$tests = @(
  @{ game = 'snake';          score = 100; duration = 25; expectedReward = 10.00 }   # 100/25=4 pts/s < 5
  @{ game = 'pong';           score = 30;  duration = 15; expectedReward = 3.00  }   # 30/15=2 < 3
  @{ game = 'flappy';         score = 20;  duration = 10; expectedReward = 2.00  }   # 20/10=2 < 3
  @{ game = 'breakout';       score = 80;  duration = 15; expectedReward = 8.00  }   # 80/15=5.3 < 8
  @{ game = 'minesweeper';    score = 60;  duration = 15; expectedReward = 6.00  }   # 60/15=4 < 6
  @{ game = 'space-invaders'; score = 65;  duration = 10; expectedReward = 13.00 }   # 65/10=6.5 < 10, 65/5=13
  @{ game = '2048';           score = 200; duration = 15; expectedReward = 10.00 }   # 200/15=13.3 < 15, 200/20=10
)

$results = @()
$passCount = 0
$failCount = 0

Write-Host "`n=== Snake Arcade Smoke Test ===" -ForegroundColor Cyan
Write-Host "API: $API`n"

foreach ($t in $tests) {
  $game = $t.game
  Write-Host "-> [$game] " -NoNewline -ForegroundColor Yellow

  try {
    # 1. Start session
    $startBody = @{ address = $TEST_ADDR; game = $game } | ConvertTo-Json -Compress
    $startResp = Invoke-RestMethod -Uri "$API/api/session/start" -Method POST `
                   -Body $startBody -ContentType 'application/json' -TimeoutSec 10
    $sessionId = $startResp.sessionId

    if (-not $sessionId) {
      Write-Host "FAIL (no sessionId)" -ForegroundColor Red
      $failCount++; continue
    }

    # 2. Wait minimum duration
    Write-Host "session=$($sessionId.Substring(0,10))... wait $($t.duration)s... " -NoNewline

    Start-Sleep -Seconds $t.duration

    # 3. End session with score
    $endBody = @{ sessionId = $sessionId; score = $t.score } | ConvertTo-Json -Compress
    try {
      $endResp = Invoke-RestMethod -Uri "$API/api/session/end" -Method POST `
                   -Body $endBody -ContentType 'application/json' -TimeoutSec 10
    } catch {
      # 400 = anti-cheat triggered
      $errBody = $_.ErrorDetails.Message
      Write-Host "FAIL (anti-cheat?) $errBody" -ForegroundColor Red
      $results += [PSCustomObject]@{ Game=$game; Expected=$t.expectedReward; Got="REJECT"; Status="FAIL" }
      $failCount++; continue
    }

    $reward = $endResp.reward
    $match = [math]::Abs($reward - $t.expectedReward) -lt 0.01

    if ($match) {
      Write-Host "OK reward=$reward (expected $($t.expectedReward))" -ForegroundColor Green
      $passCount++
    } else {
      Write-Host "MISMATCH reward=$reward (expected $($t.expectedReward))" -ForegroundColor Red
      $failCount++
    }

    $results += [PSCustomObject]@{
      Game     = $game
      Score    = $t.score
      Duration = "$($t.duration)s"
      Ratio    = "{0:N2} pts/s" -f ($t.score / $t.duration)
      Expected = $t.expectedReward
      Got      = $reward
      Status   = if ($match) { "PASS" } else { "FAIL" }
    }

    # Respect MIN_SESSION_GAP=2 entre sessions
    Start-Sleep -Seconds 3

  } catch {
    Write-Host "EXCEPTION $($_.Exception.Message)" -ForegroundColor Red
    $failCount++
  }
}

Write-Host "`n=== Results ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

Write-Host ""
if ($failCount -eq 0) {
  Write-Host "ALL PASS ($passCount/$($tests.Count))" -ForegroundColor Green
  exit 0
} else {
  Write-Host "FAILURES: $failCount/$($tests.Count)" -ForegroundColor Red
  exit 1
}
