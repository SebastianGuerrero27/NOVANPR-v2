/**
 * Tipificación del vehículo por su placa (tesis §1.3.10, Tablas 5 y 6): provincia por la primera
 * letra, tipo de servicio por la segunda y Fuerzas Armadas por la F inicial. Se muestra aunque el
 * vehículo no esté autorizado.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PROVINCIAS, tipificarPlaca } from '../src/dominio/tipificacion';
import { textoInsignia, type PistaHud } from '../src/interfaz/componentes/hud';
import { InsigniaTipificacion } from '../src/interfaz/componentes/ui';

const tipo = (placa: string) => tipificarPlaca(placa)?.categoria ?? null;

describe('Tipificación por la placa (Tabla 6)', () => {
  it('segunda letra: E gobierno central, X uso oficial, M GAD, A/U/Z comercial; otra, particular', () => {
    expect(tipificarPlaca('PEA-1234')).toMatchObject({ categoria: 'gobierno', etiqueta: 'Vehículo de gobierno', franja: 'oro', publico: true, provincia: 'Pichincha' });
    expect(tipificarPlaca('GXA1234')).toMatchObject({ categoria: 'oficial', franja: 'oro', publico: true, provincia: 'Guayas' });
    expect(tipificarPlaca('QMC5678')).toMatchObject({ categoria: 'gad', franja: 'verde_limon', publico: true, provincia: 'Orellana' });
    expect(['PAA1234', 'GUA1234', 'AZB1234'].map(tipo)).toEqual(['comercial', 'comercial', 'comercial']);
    expect(tipificarPlaca('PBA-1234')).toMatchObject({ categoria: 'particular', etiqueta: 'Vehículo particular', franja: 'blanco_plateado', publico: false });
  });

  it('formato antiguo de 3 dígitos: provincia sí, servicio no (PXL-512 del video tiene la franja blanca de un particular)', () => {
    expect(tipificarPlaca('PDO-418')).toMatchObject({ categoria: 'antiguo', provincia: 'Pichincha', publico: false });
    expect(tipificarPlaca('PXL512')).toMatchObject({ categoria: 'antiguo', provincia: 'Pichincha' });
    expect(tipificarPlaca('GEA123')?.categoria).toBe('antiguo');
  });

  it('F inicial: Fuerzas Armadas, aunque la segunda letra sea de otro servicio', () => {
    expect(tipificarPlaca('FEA1234')).toMatchObject({ categoria: 'fuerzas_armadas', publico: true, provincia: null });
  });

  it('una letra inicial sin provincia no impide tipificar el servicio', () => {
    expect(tipificarPlaca('DEA1234')).toMatchObject({ categoria: 'gobierno', provincia: null });
  });

  it('motocicletas sin servicio inferido; lecturas sin formato ANT no se tipifican', () => {
    expect(tipificarPlaca('ab-123c')).toMatchObject({ categoria: 'motocicleta', provincia: null });
    expect(tipificarPlaca('ABC12')).toBeNull();
    expect(tipificarPlaca(null)).toBeNull();
    expect(tipificarPlaca('')).toBeNull();
  });

  it('Tabla 5: 24 provincias; D y F no son provincias', () => {
    expect(Object.keys(PROVINCIAS)).toHaveLength(24);
    expect(PROVINCIAS.U).toBe('Cañar');
    expect(PROVINCIAS.X).toBe('Cotopaxi');
    expect(PROVINCIAS.J).toBe('Santo Domingo de los Tsáchilas');
    expect(PROVINCIAS.D).toBeUndefined();
    expect(PROVINCIAS.F).toBeUndefined();
  });
});

describe('Tipificación visible para el guardia', () => {
  const pista = (placa: string, estado: string | null): PistaHud => ({
    id: 1, caja: [0, 0, 0.1, 0.1], puntos: null, velocidad: [0, 0], confianza: 0.9,
    placa, parcial: null, confianzaPlaca: 0.97, estado,
  });

  it('el HUD del video agrega el tipo de vehículo entre la placa y el estado', () => {
    expect(textoInsignia(pista('PEA1234', 'no_reconocido'))).toBe('PEA-1234  •  GOBIERNO  •  NO REGISTRADO');
    expect(textoInsignia(pista('PBA1234', null))).toBe('PBA-1234  •  PARTICULAR  •  97%');
  });

  it('la insignia muestra el tipo y la provincia de un vehículo no autorizado', () => {
    render(<InsigniaTipificacion placa="QMC-5678" provincia />);
    expect(screen.getByText('Vehículo de GAD')).toHaveAttribute('title', expect.stringContaining('matriculado en Orellana'));
    expect(screen.getByText('Orellana')).toBeInTheDocument();
  });

  it('sin formato de placa ANT muestra un guion', () => {
    render(<InsigniaTipificacion placa="XYZ" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
