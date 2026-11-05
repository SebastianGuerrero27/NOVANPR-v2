import { types } from 'pg';
import '../../infraestructura/postgres';

/** COUNT(*) es bigint: como texto, '0' cuenta como verdadero en el navegador. */
describe('PostgreSQL · tipos', () => {
  it('los conteos llegan como número', () => {
    const leer = types.getTypeParser(types.builtins.INT8, 'text');
    expect(leer('0')).toBe(0);
    expect(leer('12')).toBe(12);
  });

  it('las fechas siguen siendo días del calendario', () => {
    expect(types.getTypeParser(types.builtins.DATE, 'text')('2026-10-29')).toBe('2026-10-29');
  });
});
