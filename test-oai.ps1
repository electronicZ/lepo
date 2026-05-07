$headers = @{
    'Authorization' = 'Bearer sk-GXruXemhApou1DimobKhFT6dAhE6i3gnRC087JtLfzNeSfqj'
    'Content-Type' = 'application/json'
}
$body = @{
    model = "gpt-image-2-oai"
    prompt = "a beautiful landscape, wide screen, cinematic"
    response_format = "url"
    size = "1536x1024"
} | ConvertTo-Json

$base = 'https://async.xinbao-ai.com'
try {
    $r = Invoke-RestMethod -Uri "$base/v1/images/generations" -Method POST -Headers $headers -Body $body -TimeoutSec 30
    Write-Host "提交成功，任务ID: $($r.id)"
    Write-Host "轮询URL: $($r.polling_url)"
    Write-Host "初始状态: $($r.status)"
    $taskId = $r.id

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 5
        $t = Invoke-RestMethod -Uri "$base/v1/tasks/$taskId" -Headers $headers -TimeoutSec 20
        Write-Host "轮询$($i+1): status=$($t.status)"
        if ($t.status -eq 'succeeded') {
            $url = $t.result.data[0].url
            Write-Host "图片URL: $url"
            break
        }
        if ($t.status -eq 'failed') {
            Write-Host "失败: $($t.error)"
            break
        }
    }
} catch {
    $_.Exception.Response.StatusCode
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Host $reader.ReadToEnd()
}
