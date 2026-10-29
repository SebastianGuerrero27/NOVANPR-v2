const mockQuery = jest.fn();
jest.mock('../../infraestructura/db', () => ({
  getDB: () => ({
    request: () => ({
      input: jest.fn().mockReturnThis(),
      query: mockQuery,
    }),
  }),
}));

import { repositorioUsuariosSql } from '../../infraestructura/persistencia/usuariosSql';

describe('Repositorio SQL de usuarios', () => {
  beforeEach(() => mockQuery.mockReset().mockResolvedValue({ recordset: [{ id: 42 }] }));

  it('crea la cuenta con email_verificado booleano en PostgreSQL', async () => {
    const id = await repositorioUsuariosSql.crear({
      email: 'prueba@gmail.com',
      nombre_completo: 'Persona de Prueba',
      cargo: null,
      passwordHash: 'hash',
      rol: 'Guardia',
    }, 1);

    expect(id).toBe(42);
    expect(mockQuery.mock.calls[0][0]).toContain("'activo', TRUE, @creador");
  });
});
