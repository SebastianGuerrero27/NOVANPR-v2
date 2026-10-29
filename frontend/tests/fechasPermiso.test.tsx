/**
 * Fechas de los permisos: una fecha que llega con hora no tumba el formulario («RangeError:
 * Invalid time value» al autorizar una placa de la lista blanca) y un día AAAA-MM-DD se muestra
 * ese mismo día en Ecuador, no el anterior.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { diaIso, fecha, fechaHora, hora } from '../src/dominio/formato';
import { VigenciaPermiso } from '../src/interfaz/componentes/VigenciaPermiso';

describe('Formato de fechas', () => {
  it('un día AAAA-MM-DD se muestra ese mismo día (antes, medianoche UTC lo mostraba el anterior)', () => {
    expect(fecha('2026-10-29')).toMatch(/^29 oct/);
    expect(fecha('2026-01-01')).toMatch(/^01 ene/);
    // Un instante con hora sigue mostrándose en la hora de Ecuador
    expect(fechaHora('2026-10-29T13:05:00Z')).toMatch(/29 oct.*08:05/);
  });

  it('una fecha inválida se muestra como «—» en lugar de interrumpir la vista', () => {
    for (const malo of ['no-es-fecha', '2026-10-29T00:00:00.000ZT12:00:00-05:00', '2026-13-45']) {
      expect(fecha(malo)).toBe('—');
      expect(fechaHora(malo)).toBe('—');
      expect(hora(malo)).toBe('—');
    }
    expect(fecha(null)).toBe('—');
  });

  it('diaIso deja el día de una fecha con o sin hora', () => {
    expect(diaIso('2026-10-29T00:00:00.000Z')).toBe('2026-10-29');
    expect(diaIso('2026-10-29')).toBe('2026-10-29');
    expect(diaIso(null)).toBe('');
    expect(diaIso('29/10/2026')).toBe('');
  });
});

describe('Vigencia del permiso', () => {
  it('recibe fechas con hora (como las del permiso encontrado por placa) sin romperse', () => {
    render(<VigenciaPermiso prefijo="t" inicio="2026-10-29T00:00:00.000Z" fin="2026-12-31T00:00:00.000Z" onCambiar={vi.fn()} />);
    expect(screen.getByLabelText('Vigente desde')).toHaveValue('2026-10-29');
    expect(screen.getByLabelText('Vigente hasta')).toHaveValue('2026-12-31');
    expect(screen.getByText(/Desde 29 oct 2026 hasta 31 dic 2026 inclusive/)).toBeInTheDocument();
  });
});
