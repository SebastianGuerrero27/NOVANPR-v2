# Datos del vehículo: registro manual

Desde el 28 de octubre de 2026 se retiró la consulta externa por placa por el costo de créditos. Marca, modelo, tipo y color se completan manualmente, tanto en lista blanca y negra como en solicitudes y validación de ingreso.

Las rutas anteriores `POST /api/vehiculos-autorizados/consultar-vehiculo` y `GET /api/vehiculos-autorizados/estado-consulta-vehiculo` responden HTTP 410 con `codigo: CONSULTA_EXTERNA_RETIRADA`, sin cargar ni contactar proveedores. También se retiró la consulta externa de cédula.

No se borraron claves privadas ni se modificaron cuentas del proveedor. Los adaptadores históricos aislados no se conectan a las rutas de los formularios. La búsqueda exacta de un permiso en las listas y la obtención de fotos del historial son operaciones locales sin consumo de créditos.
