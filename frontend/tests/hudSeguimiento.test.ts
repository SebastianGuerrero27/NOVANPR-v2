/**
 * Caja de la placa sobre el video en vivo: el motor la mide en un cuadro y el navegador muestra ese
 * cuadro un poco después (búfer de reproducción y red). La caja se mueve con su velocidad hasta el
 * cuadro que se está viendo, para no quedar ni detrás de la placa ni por delante de ella.
 */
import { describe, expect, it } from 'vitest';
import { anticipoCaja } from '../src/interfaz/componentes/hud';

describe('Adelanto de la caja hasta el cuadro que muestra el video', () => {
  it('sin retardo de video, la adelanta desde que el motor la midió hasta ahora', () => {
    expect(anticipoCaja(0.03, 0.02, 0)).toBeCloseTo(0.05);
  });

  it('con el video más atrasado que la medición, la lleva hacia atrás', () => {
    expect(anticipoCaja(0.03, 0.02, 0.17)).toBeCloseTo(-0.12);
  });

  it('acota el adelanto y el retroceso', () => {
    expect(anticipoCaja(2, 1, 0)).toBe(0.25);
    expect(anticipoCaja(0, 0, 5)).toBe(-0.6);
  });
});
