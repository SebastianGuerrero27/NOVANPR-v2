# Instala el Sistema ANPR ECU 911 desde el paquete de producción, sin internet (Windows con Docker Desktop).
#
#   powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1 -Ip 192.168.1.50
#
# 1) carga las imágenes, 2) crea .env con secretos nuevos (si no existe) y 3) arranca los servicios.
# Se puede repetir: no borra datos ni el .env. Los pesos de los modelos van dentro de la imagen del motor.
param([string]$Ip = '')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $Ip) {
  $Ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|WSL|Docker' } |
    Select-Object -First 1).IPAddress
}
if (-not $Ip) { throw 'Indique la IP del servidor: scripts\instalar.ps1 -Ip 192.168.1.50' }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falta Docker Desktop con Docker Compose v2.' }

function Azar([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return [Convert]::ToBase64String($b)
}
function Alfanumerico([int]$largo) { return ((Azar 96) -replace '[^A-Za-z0-9]', '').Substring(0, $largo) }

Write-Host '1/3 Cargando las imágenes (puede tardar varios minutos)...'
docker load -i imagenes\anpr_imagenes.tar
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron cargar las imágenes.' }

Write-Host '2/3 Configuración (.env)...'
if (Test-Path .env) {
  Write-Host '    .env ya existe: se conserva tal cual.'
} else {
  $envTexto = @"
# Sistema ANPR ECU 911 · generado por scripts\instalar.ps1 el $(Get-Date -Format yyyy-MM-dd).
# GUARDE UNA COPIA SEGURA de este archivo: CAMARAS_CLAVE_CIFRADO cifra las contraseñas de las
# cámaras y del correo; si se pierde, hay que volver a escribirlas.
DB_USER=anpr
DB_PASSWORD=$(Alfanumerico 32)
JWT_SECRET=$(Azar 48)
CAMARAS_CLAVE_CIFRADO=$(Azar 32)
ANPR_SERVICE_TOKEN=$(Alfanumerico 40)

# Direcciones con que el personal abre el sistema desde la red local (obligatorias)
FRONTEND_URL=http://${Ip}:3000
WEBRTC_HOSTS=127.0.0.1,$Ip
WEBRTC_PUBLIC_URL=http://${Ip}:8889
ANPR_PUBLIC_URL=http://${Ip}:8000

# Redes donde están las cámaras (CIDR separados por coma). Vacío = redes privadas.
# Recomendado: solo la VLAN de cámaras, p. ej. 10.20.30.0/24
CAMARAS_REDES_PERMITIDAS=
"@
  # UTF-8 sin BOM: Docker Compose lee el .env tal cual
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $envTexto, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "    .env creado con secretos nuevos (IP $Ip)."
}

Write-Host '3/3 Arrancando...'
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron arrancar los servicios (vea docker compose logs).' }
docker compose ps
Write-Host ''
Write-Host "Listo. En 1 a 5 minutos todos los servicios quedan 'healthy' (docker compose ps)."
Write-Host "Abra http://${Ip}:3000, cree el primer administrador y registre la cámara de la garita."
