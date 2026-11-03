# Upload the static web app (web/) to the EC2 instance's nginx root.
#   .\deploy-web.ps1                     (uses the defaults below)
#   .\deploy-web.ps1 -Server ec2-user@<public-dns> -Key C:\path\to\key.pem
param(
    [string]$Server = "ec2-user@3.17.254.71",
    [string]$Key = "$env:USERPROFILE\.ssh\ECE513.pem"
)
$ErrorActionPreference = "Stop"
$web = Join-Path $PSScriptRoot "..\web"
$archive = Join-Path $env:TEMP "smartvent-web.tar.gz"

# Ship one archive and swap the directory contents, so files deleted locally
# also disappear from the server.
tar -czf $archive -C $web .
scp -q -i $Key $archive "${Server}:/tmp/smartvent-web.tar.gz"
ssh -i $Key $Server "rm -rf /var/www/smartvent/* && tar -xzf /tmp/smartvent-web.tar.gz -C /var/www/smartvent && rm /tmp/smartvent-web.tar.gz"
Remove-Item $archive
if ($LASTEXITCODE -ne 0) { throw "upload failed" }
Write-Host "Website updated on $Server"
