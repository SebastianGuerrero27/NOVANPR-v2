/**
 * Color de cada fila de las tablas de movimientos según el estado del acceso: rojo solo para las
 * alertas de lista negra y los pasos sin lectura de placa; todo lo que entra al registro, blanco.
 */
import { describe, expect, it } from 'vitest';
import { estadoAcceso, puedeRegistrarSalida } from '../src/dominio/estadoAcceso';
import type { Deteccion } from '../src/dominio/tipos';

const paso = (c: Partial<Deteccion> = {}) => ({
  estado_validacion: 'autorizado', estado_procesamiento: 'procesado', validado_manualmente: false, tipo_movimiento: 'ingreso', fecha_hora_salida: null,
  persona_ingreso: 'Ana Torres', placa: 'ABC1234', tipo_vehiculo: 'SUV', vehiculo: { marca: 'Mazda', tipo: 'SUV' }, motivo_ingreso: 'Reunión', fecha_hora_ingreso: '2026-10-22T15:00:00Z', ...c,
} as Parameters<typeof estadoAcceso>[0] & Partial<Deteccion>);
const permiso = { id: 1, propietario: 'Ana Torres', departamento: null };

describe('Estado del acceso para el color de la fila', () => {
  it('la lista negra va en rojo siempre, incluso con salida o permiso', () => {
    expect(estadoAcceso(paso({ estado_validacion: 'alerta' }))).toBe('alerta');
    expect(estadoAcceso(paso({ estado_validacion: 'alerta', autorizado: permiso, tipo_movimiento: 'salida', fecha_hora_salida: '2026-10-22T15:30:00Z' }))).toBe('alerta');
  });

  it('un paso sin lectura de placa va en rojo hasta que el personal lo resuelve', () => {
    expect(estadoAcceso(paso({ estado_validacion: 'pendiente_revision', estado_procesamiento: 'no_legible', placa: null }))).toBe('sin_lectura');
    expect(estadoAcceso(paso({ estado_validacion: 'pendiente_revision', estado_procesamiento: 'no_legible', placa: null, sin_placa: true }))).toBe('sin_lectura');
    expect(estadoAcceso(paso({ estado_validacion: 'salida_registrada', tipo_movimiento: 'salida', placa: null }))).toBe('sin_lectura');
    // Confirmada por el guardia, o identificado y autorizado por su titular: ya entró al registro
    expect(estadoAcceso(paso({ estado_validacion: 'no_reconocido', placa: null, validado_manualmente: true }))).toBe('registrado');
    expect(estadoAcceso(paso({ estado_validacion: 'autorizado', placa: null, sin_placa: true }))).toBe('registrado');
  });

  it('mientras el motor lee la placa no se pinta', () => {
    expect(estadoAcceso(paso({ estado_validacion: 'pendiente_revision', estado_procesamiento: 'pendiente_ocr', placa: null }))).toBe('registrado');
  });

  it('todo lo demás que entra al registro queda en blanco', () => {
    expect(estadoAcceso(paso())).toBe('registrado');
    expect(estadoAcceso(paso({ fecha_hora_salida: '2026-10-22T15:30:00Z' }))).toBe('registrado');
    expect(estadoAcceso(paso({ estado_validacion: 'no_reconocido' }))).toBe('registrado');
    expect(estadoAcceso(paso({ estado_validacion: 'pendiente_revision', autorizado: permiso }))).toBe('registrado');
    expect(estadoAcceso(paso({ estado_validacion: 'pendiente_revision', autorizado: null }))).toBe('registrado');
    expect(estadoAcceso(paso({ autorizado: permiso, restriccion_acceso: 'fuera_horario', estado_validacion: 'no_reconocido' }))).toBe('registrado');
    expect(estadoAcceso(paso({ estado_validacion: 'salida_registrada', tipo_movimiento: 'salida' }))).toBe('registrado');
  });

  it('una ficha incompleta no permite registrar salida aunque esté autorizada', () => {
    expect(puedeRegistrarSalida(paso({ motivo_ingreso: null }))).toBe(false);
    expect(puedeRegistrarSalida(paso({ datos_faltantes_registro: ['Marca', 'Salida'] }))).toBe(false);
    expect(puedeRegistrarSalida(paso({ datos_faltantes_registro: ['Salida'] }))).toBe(true);
  });

  it('solo un ingreso sin salida puede registrarla', () => {
    expect(puedeRegistrarSalida(paso())).toBe(true);
    expect(puedeRegistrarSalida(paso({ fecha_hora_salida: '2026-10-22T15:30:00Z' }))).toBe(false);
    expect(puedeRegistrarSalida(paso({ tipo_movimiento: 'salida' }))).toBe(false);
  });
});
