# Registro con selección de rol y sin verificación por correo

Actualizado el 29 de octubre de 2026.

El formulario público reemplaza «Cargo (opcional)» por un selector obligatorio **Rol**: **Guardia** o **Gestor de permisos**. El backend valida la misma lista; un registro público no puede asignar Administrador ni otro rol mediante una petición modificada. Las solicitudes de clientes anteriores que no incluyen rol conservan la selección de Guardia por compatibilidad.

La verificación de correo se entrega desactivada. La cuenta nueva se guarda con el rol elegido, `estado='activo'` y `email_verificado=false`; no se genera un enlace ni se invoca el envío de verificación. El correo sigue siendo identificador de acceso, con sus validaciones de formato, dominio y unicidad. La columna `cargo` permanece disponible para otros formularios y cuentas existentes.

Tras registrarse, la interfaz muestra **Cuenta creada**, el rol y el botón para iniciar sesión, con el correo prellenado. No muestra instrucciones para revisar la bandeja ni botones de reenvío cuando la verificación está desactivada.

Las cuentas antiguas pendientes pueden activarse al ingresar con su contraseña correcta mientras esta política esté desactivada. La actualización comprueba que sigan pendientes, con la misma contraseña y sin bloqueo; conserva el correo como no verificado e invalida la caché de cuenta. No se activa ninguna cuenta en masa ni al iniciar el servidor. Las cuentas inactivas o bloqueadas continúan rechazadas.

## Configuración reversible

En **Configuración → Acceso y cuentas → Verificación de correo en el registro**, el administrador puede volver a habilitarla. La clave es `registro_verificacion_email_habilitada`, con omisión `false`. La variable de entorno equivalente es `REGISTRO_VERIFICACION_EMAIL_HABILITADA`; los Compose la admiten y su ejemplo está en `.env.example`.

Al habilitarla, el registro vuelve a crear cuentas pendientes y enlaces de verificación. Los próximos inicios de sesión exigen el correo verificado según esa política. El reenvío de verificación es un no-op mientras la opción esté desactivada. No se borró la tabla `verificacionemail` ni se alteró la configuración SMTP utilizada por otras funciones.

`GET /api/auth/estado` expone `verificacion_email_requerida`. `POST /api/auth/registro` responde con `rol`, `activo`, `enviado` y la misma bandera. La interfaz utiliza la respuesta efectiva para mostrar la pantalla posterior, incluso si la configuración cambió mientras el formulario estaba abierto.

## Comprobaciones

Se probaron registro de ambos roles, rechazo de roles no permitidos, persistencia correcta de estado y rol, ausencia de tokens/correos en modo desactivado, reactivación de la política y acceso de cuentas pendientes con sus bloqueos y caché. La verificación SQL/API se ejecuta sobre un esquema aislado y revierte sus cuentas al terminar.

Los resultados del paquete publicado se conservan en `docs/resultados/registro_sin_correo_2026-10-29.json` y `docs/resultados/registro_roles_ui_2026-10-29.json`. Las pruebas de interfaz usan datos artificiales interceptados y no registran cuentas en la base real.
