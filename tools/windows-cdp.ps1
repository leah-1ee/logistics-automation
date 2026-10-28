# Existing Windows Chrome only; JSON stdin avoids credentials in command arguments.
# Input: {port, method, params}; attaches only to the local MVP admin tab.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputCommand = [Console]::In.ReadToEnd() | ConvertFrom-Json
$portNumber = [int]$inputCommand.port
if ($portNumber -lt 1 -or $portNumber -gt 65535) { throw 'Invalid local debug port' }
$appPort = 3000
if ($inputCommand.appPort) { $appPort = [int]$inputCommand.appPort }
if ($appPort -notin @(3000, 3301)) { throw 'Expected the local MVP or browser test API port' }
$appPrefix = "http://127.0.0.1:$appPort/admin"
$targets = Invoke-RestMethod -Uri "http://127.0.0.1:$portNumber/json/list"
$target = $targets | Where-Object { $_.type -eq 'page' -and $_.url.StartsWith($appPrefix) } | Select-Object -First 1
if (!$target) { throw 'Local MVP admin tab missing' }
$socket = New-Object System.Net.WebSockets.ClientWebSocket
$timeout = New-Object System.Threading.CancellationTokenSource
$timeout.CancelAfter(30000)
try {
    $null = $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $timeout.Token).GetAwaiter().GetResult()
    $requests = @($inputCommand)
    if ($inputCommand.commands) { $requests = @($inputCommand.commands) }
    $results = @()
    $requestId = 0
    foreach ($request in $requests) {
    $requestId++
    $message = @{ id = $requestId; method = $request.method; params = $request.params } | ConvertTo-Json -Compress -Depth 100
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $segment = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$bytes)
    $null = $socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, $timeout.Token).GetAwaiter().GetResult()
    while ($true) {
        $stream = New-Object IO.MemoryStream
        try {
            do {
                $buffer = New-Object byte[] 65536
                $chunk = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$buffer)
                $received = $socket.ReceiveAsync($chunk, $timeout.Token).GetAwaiter().GetResult()
                if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw 'CDP connection closed' }
                $stream.Write($buffer, 0, $received.Count)
            } while (!$received.EndOfMessage)
            $reply = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
            if ($reply.id -eq $requestId) {
                if ($reply.error) { throw ($reply.error | ConvertTo-Json -Compress) }
                $results += $reply.result
                break
            }
        } finally { $stream.Dispose() }
    }
    }
    if ($inputCommand.commands) { ConvertTo-Json -InputObject @($results) -Compress -Depth 100 }
    else { $results[0] | ConvertTo-Json -Compress -Depth 100 }
} finally {
    $socket.Dispose()
    $timeout.Dispose()
}
