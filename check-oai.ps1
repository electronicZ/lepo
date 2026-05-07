$headers = @{
    'Authorization' = 'Bearer sk-GXruXemhApou1DimobKhFT6dAhE6i3gnRC087JtLfzNeSfqj'
}
$taskId = 'img_mddvbbko7lj2exaw'
Start-Sleep -Seconds 10
try {
    $t = Invoke-RestMethod -Uri "https://async.xinbao-ai.com/v1/tasks/$taskId" -Headers $headers -TimeoutSec 20
    Write-Host "状态: $($t.status)"
    if ($t.status -eq 'succeeded') {
        Write-Host "图片URL: $($t.result.data[0].url)"
    } else {
        Write-Host ($t | ConvertTo-Json -Depth 5)
    }
} catch {
    Write-Host "请求失败: $($_.Exception.Response.StatusCode)"
}
