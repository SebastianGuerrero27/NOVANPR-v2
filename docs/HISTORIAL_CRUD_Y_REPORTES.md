# Historial completo y generación de reportes

Actualización: 5 de noviembre de 2026.

## Administración del historial

El administrador dispone de creación manual, consulta, edición y eliminación desde **Historial completo**. Las acciones se muestran en la tabla y en el panel del registro. Las altas usan el registro manual existente y mantienen el cruce con las listas de control.

La edición administrativa corrige la placa, la cédula, la persona, el motivo del ingreso y los datos del vehículo. Requiere un motivo de corrección y deja constancia en la auditoría. No modifica los permisos de las listas ni reemplaza las fotos o la lectura original del motor. Cambiar la placa de un ingreso requiere revisar de nuevo su autorización; corregir solamente la ficha conserva la decisión del acceso. Las fechas y las relaciones entre ingresos y salidas se mantienen bajo las reglas del sistema.

La placa de una salida se corrige mediante su validación. Un ingreso con salida vinculada tampoco permite cambiar la matrícula desde este editor; los demás datos permanecen editables. Si un campo se completa desde el permiso de la lista blanca, el sistema pide escribir el dato corregido en lugar de vaciarlo y volver a mostrar el dato anterior. La cédula puede dejarse vacía de manera explícita.

`PATCH /api/detecciones/:id/registro` exige el permiso `detecciones:gestionar`, exclusivo de **Admin**. La eliminación conserva su motivo obligatorio y su auditoría. Guardia y Gestor de permisos mantienen sus funciones operativas y no reciben edición administrativa del historial.

La acción individual **Eliminar registro** está disponible para Guardia y Admin mediante `detecciones:eliminar-individual`, en Gestión de Accesos, Registro de Salidas e Historial completo. Reutiliza la confirmación con motivo auditado y actualiza la lista tras terminar. `DELETE /api/detecciones/:id` exige ese permiso. La eliminación masiva `DELETE /api/detecciones` continúa exigiendo `detecciones:eliminar`, exclusivo de Admin.

### Eliminar todo el historial

El administrador con `detecciones:eliminar` dispone de **Eliminar todos** en el encabezado de Historial completo. El diálogo exige seleccionar un motivo y escribir **ELIMINAR**. Esta opción elimina todas las detecciones y sus fotografías, de cualquier fecha, cámara o estado; los filtros de la pantalla no limitan el alcance. La auditoría se conserva. Si las cámaras siguen activas, pueden registrar nuevos movimientos después de terminar.

El diálogo reutiliza la eliminación masiva existente, sin enviar filtros. No presenta el conteo de la página como si fuera el total del sistema, ya que la eliminación global también incluye estados de procesamiento que no se muestran en la tabla.

## Generar un reporte

1. Abrir **Reportes**: la vista **Registros y filtros** lista todo el historial, paginado y sin limitarlo al día actual.
2. Elegir búsqueda, período, estado o cámara. **Más filtros** permite precisar placa, persona, movimiento y salida registrada. La lista y su cantidad se actualizan automáticamente.
3. También se puede pulsar una placa o una persona de la tabla para aplicar ese filtro.
4. Elegir PDF o CSV y pulsar **Generar reporte de esta lista**.

El archivo incluye todos los resultados que cumplan los filtros al generar, no solo la página visible. Tabla y descargas comparten el mismo objeto de filtros; la paginación queda fuera de la exportación. La generación se bloquea mientras hay una búsqueda pendiente, errores o resultados de una consulta anterior. Las salidas vinculadas se muestran en la fila de su ingreso; las salidas independientes aparecen aparte.

La ruta `GET /api/detecciones/historial/reporte.pdf` admite registros incompletos y movimientos sin lectura, sin imponer los filtros de la antigua hoja de salidas. El PDF admite hasta 5000 registros, sin recortes silenciosos. Para cantidades mayores se ofrece CSV, o se pueden acotar los filtros.

Los enlaces anteriores desde el historial (`vista=vehiculo&placa=…` o `vista=persona&persona=…`) abren directamente la lista filtrada. Los análisis por período, vehículo y persona, y la hoja de control de garita, se conservan como opciones adicionales del selector **Vista de reportes**. En esos análisis el botón **Generar reporte** sigue aplicando sus propios parámetros.

## Abrir un acceso desde la notificación

Pulsar la caja o el título de una notificación abre `/monitoreo?registro=ID`, selecciona ese movimiento en **Visualización de accesos** y mantiene el filtro **Todos los accesos**. Si el registro pertenece a otra página, se carga su ficha sin agregar filas artificiales ni alterar el total. Si ya está completo y cerrado, el aviso indica que se encuentra en Registro de Salidas. Los botones del aviso y el zoom conservan sus propias acciones. Navegar no marca la alerta como atendida; **Enterado** mantiene esa función.

La navegación y la carga directa pasaron 9 pruebas de frontend y 2 comprobaciones de navegador sobre Docker con datos artificiales, sin modificar registros ni enviar notificaciones reales. Evidencia en `docs/resultados/aviso_abrir_monitoreo_ui_2026-11-04.json`.

## Separación entre monitoreo y salidas

El monitoreo lista los accesos sin salida o pendientes de completar mediante `completos=no`, aplicado por la API antes del conteo y la paginación. Cuando un ingreso tiene nombre, tipo de vehículo, marca, motivo y fechas válidas de ingreso y salida, deja de mostrarse en esa tabla y en el feed. La placa es opcional. **Registro de Salidas** lo muestra con `cerrados=si&completos=si`; el historial conserva el mismo registro y sus evidencias.

Un ingreso que tiene salida pero aún carece de un dato obligatorio permanece editable en monitoreo. Al guardar el último dato, se retira de inmediato. El cierre manual y los eventos en tiempo real aplican el mismo comportamiento. Se reutiliza la regla del servidor, sin migración de base de datos ni eliminación de registros.

Validación: 17 pruebas de frontend, 27 de backend y 4 comprobaciones del navegador sobre Docker. También se verifica que un ingreso reabierto reaparezca sin conservar el cierre de una edición local anterior. La compilación de producción pasó TypeScript y la revisión de arquitectura. Evidencia con datos artificiales en `docs/resultados/traslado_salidas_ui_2026-11-04.json`.

### Salidas con placa ilegible o rótulo de concesionaria

En **Autorizar ingreso**, la acción **Sin placa legible** vacía la propuesta del OCR. Al confirmar, se guarda `placa_validada: null` y se retira la candidata de `placa_reconocida`, conservándola en `placa_ocr_original`. Las fotografías, la observación OCR y las notas se conservan. El registro manual también admite placa vacía. Una matrícula escrita sigue exigiendo su formato válido.

Con los demás datos completos, **Registrar salida** cierra ese ingreso por su ID aunque las salidas generales se encuentren en modo automático. Esta excepción se limita al ingreso sin matrícula legible y mantiene el permiso de validación y la auditoría; no habilita salidas manuales generales. Dos movimientos con placa nula nunca se asocian automáticamente. El registro pasa a **Registro de Salidas**, el PDF muestra **S/P** y la hoja de control usa la salida guardada en el propio ingreso.

No hace falta migración: las columnas de placa ya admiten `NULL`. El ensayo SQL del repositorio compilado pasó 6 comprobaciones en un esquema aislado que se revirtió por completo, sin cambios en los registros operativos. Evidencia en `docs/resultados/salida_placa_null_sql_2026-11-04.json`.

La actualización pasó 55 pruebas de frontend, 211 de backend, la compilación de ambas imágenes y 3 comprobaciones del navegador con API interceptada. El flujo visual confirma descartar la lectura, guardar la matrícula nula sin recargar, cerrar solo ese ingreso en modo automático y verlo con evidencia en Salidas. Resultado en `docs/resultados/salida_placa_null_ui_2026-11-04.json`.

## Menú lateral y retiro de la pantalla de detalle

Los títulos de todos los módulos del menú lateral se presentan en mayúsculas. **REGISTRO DE CÁMARAS** permite desplegar u ocultar las cámaras mediante el nombre o la flecha; el nombre también abre la gestión de cámaras. El navegador conserva la preferencia de despliegue. Se mantienen la navegación, el arrastre de las cámaras habilitadas y el control desde el teclado y el menú móvil.

La pantalla independiente de detalle se retiró. Los enlaces de Historial, Salidas, Reportes y las demás vistas operativas abren `/monitoreo?registro=ID`; ya no existe el botón **Ver detalle** en monitoreo. Los enlaces anteriores `/detecciones/:id` redirigen al mismo destino y conservan los controles de sesión y permisos. Las fotografías, el zoom y los datos del registro siguen disponibles en las vistas operativas. La API de consulta por ID se conserva porque la utiliza el monitoreo.

Validación del cambio: 22 pruebas de frontend en 7 suites, compilación de producción con TypeScript y arquitectura, y 4 comprobaciones de navegador sobre Docker con datos artificiales. Evidencia en `docs/resultados/sidebar_sin_detalle_ui_2026-11-05.json`.

## Despliegue local

```powershell
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml build backend frontend
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml up -d --no-deps --wait backend frontend
```

Interfaz: <http://localhost:3000>. Si el navegador conserva una versión anterior, actualizar con **Ctrl+F5**. Las comprobaciones visuales se realizan con datos artificiales, sin modificar los registros de operación.

## Validación

- Backend: 168 pruebas focales de permisos, contrato HTTP, casos de uso, SQL y OpenAPI; 7 pruebas adicionales de los documentos de control y salidas.
- Frontend: 14 pruebas de reportes y 13 de administración del historial y registro manual; TypeScript y arquitectura verificados.
- Navegador sobre los archivos servidos por Docker: alta, edición, eliminación, generación, descargas, enlace directo, separación de permisos y adaptación móvil con API interceptada y datos artificiales.
- PostgreSQL real: ensayo del repositorio compilado en un esquema privado, dentro de una transacción revertida. Resultado en `docs/resultados/historial_crud_sql_2026-11-04.json`.

Despliegue verificado: frontend y backend saludables; `/healthz` y `/health/ready` responden 200. La ruta de edición administrativa sin sesión responde 401. Evidencias técnicas en `docs/resultados/historial_reportes_ui_2026-11-04.json` y `docs/resultados/historial_reportes_despliegue_2026-11-04.json`.

La actualización posterior de **Registros y filtros** pasó 145 pruebas de backend, 24 de frontend y 7 comprobaciones de navegador sobre Docker. Se verificaron filtros combinados, descarga desde la segunda página sin limitar el archivo a esa página, búsqueda pendiente, limpieza y enlaces anteriores. Los resultados están en `docs/resultados/reportes_lista_ui_2026-11-04.json` y `docs/resultados/reportes_lista_despliegue_2026-11-04.json`. La ruta PDF nueva sin sesión responde 401.
