jest.mock('../../infraestructura/servicios/configuracion', () => ({ politicaAutorizacion: () => ({ criterio: 'validez_y_confianza', confianzaMinima: 0.8, fuenteConfianza: 'ocr', verificarVehiculo: false }) }));
jest.mock('../../infraestructura/servicios/media', () => ({ urlMedia: (ruta: unknown) => ruta ?? null }));
import { presentarDeteccion } from '../../infraestructura/presentacionDetecciones';

it('editar una celda conserva los datos del padrón que la ficha aún no contiene', () => {
  const dto = presentarDeteccion({ id: 15, estado_validacion: 'autorizado', estado_procesamiento: 'procesado',
    vehiculo_autorizado_id: 7, propietario: 'Ana Torres', autorizado_cedula: '0102030405', autorizado_institucion: 'ECU 911',
    autorizado_cargo: 'Analista', departamento: 'Tecnología', autorizado_horario: null,
    cedula_ingreso: '0123456789', vehiculo_marca: 'Mazda',
  });
  expect(dto.datos_permiso).toMatchObject({ propietario: 'Ana Torres', cedula: '0123456789', institucion: 'ECU 911', cargo: 'Analista', departamento: 'Tecnología', marca: 'Mazda' });
});

it('conserva el borrado explícito de una cédula (vacía) sin reponer el dato del padrón; sin escribir (NULL) lo toma del padrón', () => {
  const vaciada = presentarDeteccion({ id: 15, estado_validacion: 'autorizado', vehiculo_autorizado_id: 7,
    autorizado_cedula: '0102030405', cedula_ingreso: '',
  });
  expect(vaciada.datos_permiso.cedula).toBeNull();
  const sinEscribir = presentarDeteccion({ id: 15, estado_validacion: 'autorizado', vehiculo_autorizado_id: 7,
    autorizado_cedula: '0102030405', cedula_ingreso: null,
  });
  expect(sinEscribir.datos_permiso.cedula).toBe('0102030405');
});

it('cada campo del formulario sale de su columna: vigencia como AAAA-MM-DD y sin padrón ni ficha no hay datos', () => {
  const dto = presentarDeteccion({ id: 16, persona_ingreso: 'Rosa Vera', institucion_ingreso: 'ECU 911', categoria_permiso: 'VISITANTE',
    observaciones_permiso: 'Placa sucia', vigencia_desde: new Date('2026-10-24T00:00:00Z'), vigencia_hasta: '2026-10-31', motivo_ingreso: 'Reunión' });
  expect(dto.datos_permiso).toMatchObject({ propietario: 'Rosa Vera', institucion: 'ECU 911', categoria: 'VISITANTE', observaciones: 'Placa sucia',
    fecha_inicio: '2026-10-24', fecha_fin: '2026-10-31', motivo_ingreso: 'Reunión', horario: null });
  expect(presentarDeteccion({ id: 17 }).datos_permiso).toBeNull();
});


it('presenta texto general OCR como observación en listado y detalle sin ocupar la matrícula ni el motivo', () => {
  const evidencia = { observacion_ocr: 'Concesionario Ejemplo', confianza_texto_ocr: 0.97,
    motivo: 'texto_no_matricula', candidata_descartada: 'QIH6060' };
  const fila = { id: 25, estado_procesamiento: 'no_legible', estado_validacion: 'pendiente_revision',
    placa_reconocida: null, placa_validada: null, motivo_ingreso: 'Jornada laboral', evidencia_lectura: JSON.stringify(evidencia) };
  const lista = presentarDeteccion(fila);
  expect(lista.placa).toBeNull();
  expect(lista.evidencia_lectura).toEqual({ observacion_ocr: 'Concesionario Ejemplo', confianza_texto_ocr: 0.97, motivo: 'texto_no_matricula' });
  expect(lista.motivo_ingreso).toBe('Jornada laboral');
  expect(presentarDeteccion(fila, true).lectura_automatica.evidencia).toEqual(evidencia);
  expect(presentarDeteccion({ id: 26, placa_reconocida: 'PBA1234' }).evidencia_lectura).toBeNull();
});
