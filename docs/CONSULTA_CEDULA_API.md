# Datos de persona: registro manual

Desde el 28 de octubre de 2026 se retiraron las consultas externas de cédula y placa para evitar consumo de créditos. Los formularios de lista blanca, lista negra, solicitudes y validación de ingreso permiten escribir sus datos manualmente. No existen botones de consulta al proveedor ni consultas automáticas al completar un campo.

`POST /api/vehiculos-autorizados/consultar-persona` responde HTTP 410 con `codigo: CONSULTA_EXTERNA_RETIRADA` a clientes anteriores. Exige sesión y no carga el conector externo. La cédula conserva los ceros iniciales y la validación local de diez dígitos.

`CamposFormularioPermiso`, `CamposPersonaPermiso` y `CamposVehiculoPermiso` mantienen las reglas comunes de alta, edición, solicitud y validación. La ficha del ingreso se conserva en `datos_permiso`; llenarla no concede permisos de acceso. Las búsquedas del padrón y del historial local no contactan proveedores externos.
