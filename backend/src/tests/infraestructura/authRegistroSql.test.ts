const mockQuery = jest.fn();
const mockEntradas: Array<{ nombre: string; valor: unknown }> = [];
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => {
  const r = { input: (nombre: string, _tipo: unknown, valor: unknown) => { mockEntradas.push({ nombre, valor }); return r; }, query: mockQuery };
  return r;
} }) }));

import { repositorioAuthSql } from '../../infraestructura/persistencia/authSql';
import { DEFINICIONES } from '../../infraestructura/servicios/configuracion';

beforeEach(() => { mockQuery.mockReset().mockResolvedValue({ recordset: [{ id: 42 }] }); mockEntradas.length = 0; });

it.each([['Guardia', 'GUARDIA'], ['GestorPermisos', 'GESTOR_PERMISOS']] as const)('persiste rol %s y activa sin marcar el email verificado', async (rol, codigo) => {
  expect(await repositorioAuthSql.registrar({ email: 'prueba@ecu911.gob.ec', nombre_completo: 'Ana Pérez',
    cargo: null, passwordHash: 'hash', rol, requiereVerificacion: false })).toBe(42);
  expect(mockEntradas).toContainEqual({ nombre: 'c', valor: codigo });
  expect(mockEntradas).toContainEqual({ nombre: 'estado', valor: 'activo' });
  const insercion = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO Usuarios'))?.[0];
  expect(insercion).toContain('@estado, FALSE');
  expect(insercion).not.toContain('TRUE');
});

it('la política habilitada mantiene pendiente el registro', async () => {
  await repositorioAuthSql.registrar({ email: 'prueba@ecu911.gob.ec', nombre_completo: 'Ana Pérez',
    cargo: null, passwordHash: 'hash', rol: 'Guardia', requiereVerificacion: true });
  expect(mockEntradas).toContainEqual({ nombre: 'estado', valor: 'pendiente' });
});

it('el repositorio también rechaza Admin antes de escribir', async () => {
  await expect(repositorioAuthSql.registrar({ email: 'prueba@ecu911.gob.ec', nombre_completo: 'Ana Pérez',
    cargo: null, passwordHash: 'hash', rol: 'Admin', requiereVerificacion: false } as any)).rejects.toThrow('Rol de registro público inválido');
  expect(mockQuery).not.toHaveBeenCalled();
});

it('activa sólo la cuenta pendiente, con la misma contraseña y sin bloqueos', async () => {
  expect(await repositorioAuthSql.activarPendienteSinVerificacion(7,'hash-confirmado')).toBe(true);
  const sql = mockQuery.mock.calls[0][0];
  for (const guardia of ["estado = 'pendiente'",'bloqueado = FALSE','bloqueado_hasta <= CURRENT_TIMESTAMP','password_hash = @hash']) expect(sql).toContain(guardia);
  expect(sql).not.toContain('email_verificado');
  expect(mockEntradas).toContainEqual({ nombre: 'hash', valor: 'hash-confirmado' });
  mockQuery.mockResolvedValue({ recordset: [] });
  expect(await repositorioAuthSql.activarPendienteSinVerificacion(7,'hash-viejo')).toBe(false);
});

it('la verificación puede reactivarse y se entrega desactivada por omisión', () => {
  expect(DEFINICIONES.find(d => d.clave === 'registro_verificacion_email_habilitada')).toMatchObject({
    tipo: 'booleano', omision: 'false', env: 'REGISTRO_VERIFICACION_EMAIL_HABILITADA', grupo: 'Acceso y cuentas',
  });
});
