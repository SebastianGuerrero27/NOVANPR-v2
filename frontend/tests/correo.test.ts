import { describe, expect, it } from 'vitest';
import { errorCorreoInstitucional } from '../src/dominio/validacion';

describe('validación de correo para cuentas', () => {
  it('acepta cualquier dominio válido si no hay una lista configurada', () => {
    expect(errorCorreoInstitucional('prueba@gmail.com', [])).toBeNull();
  });

  it('conserva la restricción cuando hay dominios permitidos configurados', () => {
    expect(errorCorreoInstitucional('prueba@gmail.com', ['ecu911.gob.ec']))
      .toBe('Solo se aceptan correos de: @ecu911.gob.ec.');
  });

  it('sigue rechazando un correo con formato inválido aunque no haya restricción de dominio', () => {
    expect(errorCorreoInstitucional('prueba-sin-dominio', [])).toBe('Correo electrónico inválido.');
  });
});
