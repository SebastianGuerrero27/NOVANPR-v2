import type { DeteccionDTO, Fila } from '../aplicacion/detecciones';
import type { EstadoValidacion, RestriccionAcceso } from '../dominio/decisionAcceso';
import { esSinPlaca, evidenciaDe, motivoRevision, normalizarFuente, origenDe, type PasoGuardado } from '../dominio/detecciones';
import { politicaAutorizacion } from './servicios/configuracion';
import { urlMedia } from './servicios/media';
import { datoRegistro, datosRegistro, faltantesRegistro } from '../dominio/registroCompleto';
import { validarHorario } from '../dominio/horario';

/**
 * Representación única de una detección para la API y los eventos en tiempo real. Las imágenes
 * se entregan con URL firmada y temporal (infraestructura/servicios/media.ts) y el motivo de revisión se explica
 * con la política de autorización vigente (dominio/detecciones.ts).
 */
export function presentarDeteccion(d: Fila, detalle = false): DeteccionDTO {
  const registro = datosRegistro(d);
  const faltantes = faltantesRegistro(d);
  const evidencia = evidenciaDe(d);
  const datosPadron = d.vehiculo_autorizado_id ? {
    propietario: d.propietario, cedula: d.autorizado_cedula, institucion: d.autorizado_institucion,
    cargo: d.autorizado_cargo, departamento: d.departamento,
    fecha_inicio: d.autorizado_inicio ? new Date(d.autorizado_inicio).toISOString().slice(0, 10) : '',
    fecha_fin: d.autorizado_vence ? new Date(d.autorizado_vence).toISOString().slice(0, 10) : '',
    horario: d.autorizado_horario ?? null,
  } : null;
  const datosPermiso = d.datos_permiso ? { ...datosPadron, ...d.datos_permiso } : datosPadron;
  if (datosPermiso) {
    // La ficha conserva el JSON que validó el dominio; el navegador recibe las franjas ya interpretadas.
    const interpretado = validarHorario(datosPermiso.horario);
    datosPermiso.horario = interpretado.horario;
    if (interpretado.error) datosPermiso.horario_error = 'El horario guardado no es válido. Seleccione un horario antes de guardar.';
    else delete datosPermiso.horario_error;
  }
  const base = {
    id: d.id,
    placa: registro.placa,
    registro_completo: d.tipo_movimiento !== 'salida' && faltantes.length === 0,
    datos_faltantes_registro: faltantes,
    placa_reconocida: d.placa_reconocida ?? null,
    placa_validada: d.placa_validada ?? null,
    estado_validacion: d.estado_validacion as EstadoValidacion,
    estado_procesamiento: d.estado_procesamiento,
    confianza_deteccion: d.confianza_deteccion,
    confianza_ocr: d.confianza_ocr,
    fecha_hora_ingreso: d.fecha_hora_ingreso,
    fecha_hora_salida: d.fecha_hora_salida ?? null,
    tipo_movimiento: d.tipo_movimiento === 'salida' ? 'salida' : 'ingreso',
    fecha_hora_procesamiento: d.fecha_hora_procesamiento,
    // Los registros anteriores a la corrección pueden guardar la URL de lectura (con credenciales)
    fuente: d.fuente ? normalizarFuente(d.fuente) : null,
    // Cámara en vivo, video de prueba o registro manual: separa los datos reales de los de prueba
    origen: origenDe(d.fuente),
    tracking_id: d.tracking_id,
    imagen_vehiculo: urlMedia(d.ruta_imagen_ingreso),
    imagen_placa: urlMedia(d.ruta_imagen_placa || d.ruta_imagen_ingreso),
    camara: d.camara_id ? { id: d.camara_id, nombre: d.camara_nombre, ubicacion: d.camara_ubicacion } : null,
    tipo_vehiculo: registro.tipo,
    vehiculo: { tipo: registro.tipo, marca: registro.marca, modelo: datoRegistro(d.vehiculo_modelo, d.autorizado_modelo), color: d.vehiculo_color },
    verificacion_vehiculo: d.verificacion_vehiculo ?? null,
    verificacion_detalle: d.verificacion_detalle ?? null,
    alerta: d.alerta_id ? { id: d.alerta_id, motivo: d.alerta_motivo, nivel: d.nivel_alerta } : null,
    autorizado: d.vehiculo_autorizado_id
      ? { id: d.vehiculo_autorizado_id, propietario: d.propietario, departamento: d.departamento, categoria: d.autorizado_categoria ?? null } : null,
    restriccion_acceso: (d.restriccion_acceso ?? null) as RestriccionAcceso | null,
    // Hoja de control vehicular de la garita: quién ingresa y por qué
    persona_ingreso: registro.nombre,
    datos_permiso: datosPermiso,
    motivo_ingreso: registro.motivo,
    validado_manualmente: Boolean(d.validado_manualmente),
    lectura_valida: d.lectura_valida === null || d.lectura_valida === undefined ? null : Boolean(d.lectura_valida),
    motivo_revision: motivoRevision(d as PasoGuardado, politicaAutorizacion()),
    sin_placa: esSinPlaca(d),
    // Texto general como observación; no ocupa el campo de matrícula ni el motivo del ingreso.
    evidencia_lectura: typeof evidencia?.observacion_ocr === 'string' && evidencia.observacion_ocr.trim()
      ? { observacion_ocr: evidencia.observacion_ocr, confianza_texto_ocr: evidencia.confianza_texto_ocr, motivo: evidencia.motivo }
      : null,
    validacion: d.validado_manualmente
      ? { usuario: d.validador_nombre ? { id: d.usuario_validador_id, nombre: d.validador_nombre, email: d.validador_email } : null, fecha: d.fecha_validacion }
      : null,
  };
  if (!detalle) return base;
  return {
    ...base,
    lectura_automatica: {
      placa: d.placa_ocr_original, confianza: d.confianza_ocr_original, decision: d.decision_automatica,
      verificador: d.lectura_verificador, latencia_ms: d.latencia_ms,
      modelo_detector: d.modelo_detector, modelo_ocr: d.modelo_ocr,
      valida: d.lectura_valida === null || d.lectura_valida === undefined ? null : Boolean(d.lectura_valida),
      evidencia,
    },
    captura: {
      luminancia_media: d.luminancia_media, distancia_estimada_m: d.distancia_estimada_m,
      ancho_placa_px: d.ancho_placa_px, nitidez: d.nitidez, velocidad_px_s: d.velocidad_px_s,
      condicion_clima: d.condicion_clima,
    },
  };
}
