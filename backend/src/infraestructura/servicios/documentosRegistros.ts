import type { Fila } from '../../aplicacion/detecciones';
import { placaHoja } from '../../dominio/controlVehicular';
import { pdfControl } from './documentosControl';
import { datosRegistro } from '../../dominio/registroCompleto';

/** La misma tabla del control vehicular, sin turnos, firmas ni estadísticas. */
export function pdfRegistros(filas: Fila[], generado: Date, zona: string): Promise<Buffer> {
  const fecha = (v: Date | string) => new Intl.DateTimeFormat('es-EC', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(v));
  const hora = (v: Date | string) => new Intl.DateTimeFormat('es-EC', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(v));
  return pdfControl({
    sede: 'SISTEMA ANPR ECU 911', titulo: 'REGISTROS VEHICULARES', lugar: 'Visitas con salida registrada',
    lineaFecha: '', agente: '', turno: '', horario: '', camara: null,
    generado: `${fecha(generado)} ${hora(generado)}`,
    filas: filas.map(d => ({
      fecha: fecha(d.fecha_hora_ingreso), nombres: datosRegistro(d).nombre || '',
      tipo: datosRegistro(d).tipo || '',
      marca: datosRegistro(d).marca || '', placa: placaHoja(datosRegistro(d).placa),
      ingreso: hora(d.fecha_hora_ingreso), salida: `${fecha(d.fecha_hora_salida)} ${hora(d.fecha_hora_salida)}`,
      observaciones: datosRegistro(d).motivo || '',
    })),
  }, true);
}
