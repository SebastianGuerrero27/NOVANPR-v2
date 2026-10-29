# Estabilización del despliegue local, 2026-10-28

Se utiliza el proyecto Compose `anpr`, con `docker-compose.yml` y el override
`docker-compose.produccion-local.yml`. Frontend y backend se compilan; el motor se empaqueta
en `anpr-motor:produccion` y ejecuta Uvicorn sin `--reload` ni montaje del código fuente.
Las fotos y la caché de modelos siguen en sus volúmenes. La configuración local del motor se
inyecta en ejecución desde su archivo `.env` opcional, que no se incorpora a la imagen.

## Correcciones

- El horario de las fichas y del autocompletado se entrega como lista o nulo. El formulario
  interpreta también JSON histórico y marca un horario dañado para corregirlo explícitamente.
  No ejecuta `.every()` sobre texto ni transforma silenciosamente datos inválidos en 24/7.
- El cierre WHEP solicita liberar la sesión antes de cerrar WebRTC. Es idempotente,
  tiene tiempo límite y cancela negociaciones anteriores al cambiar de cámara. Las pruebas
  reales de tres ciclos cambiaron los DELETE de 404 a 200, con recepción de video 1920 × 1080.
- Las consultas externas de placa y cédula se retiraron por pedido del usuario. Las rutas
  antiguas responden 410 sin conectar proveedores; los formularios se llenan manualmente.
- Los rótulos reconocidos por el OCR general se conservan como observaciones. Se retiran las
  candidatas de matrícula descartadas y se conserva el registro del mismo vehículo.

## Limitación externa comprobada

Una única consulta diagnóstica, con la misma placa de la última consulta fallida y sin
exponerla en el informe, recibió **HTTP 402 `payment_required`: saldo de créditos agotado**.
La aplicación presentaba ese rechazo del proveedor como un 503 genérico. Posteriormente se
retiraron estas consultas por pedido del usuario. No se compraron créditos ni se requiere
saldo para llenar los formularios.

`globals-front.js` no figura en las fuentes ni en los recursos generados de esta aplicación.
El origen de ese script requiere su URL completa; no se atribuye a una extensión concreta
ni se ocultan globalmente los errores del navegador.

## Aplicar una versión

Desde la raíz del proyecto:

```powershell
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml build backend frontend anpr
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml up -d --no-deps --wait --wait-timeout 180 backend frontend anpr
```

Las comprobaciones locales son `/healthz` del frontend, `/health/ready` del backend y la
salud del contenedor ANPR, seguidas de cámara conectada y recepción de cuadros. La versión
se verifica con las imágenes y el paquete servido, no sólo con las fuentes locales.

Este documento describe el despliegue local existente. No constituye una validación de
disponibilidad prolongada ni de publicación en Internet.
