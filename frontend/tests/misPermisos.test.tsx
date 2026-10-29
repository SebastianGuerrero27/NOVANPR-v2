import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 18, nombre: 'Ana Gestora' }, puede: (p: string) => p === 'padron:gestionar' }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import GestionPermisos from '../src/interfaz/paginas/GestionPermisos';

describe('Mis permisos del gestor', () => {
  it('reemplaza placas sin permiso por la consulta personal, incluyendo permisos por nombre', async () => {
    get.mockImplementation(async (ruta: string) => ({ data: ruta === '/panel/accesos' ? {
      generado: '2026-10-22T15:00:00Z', solicitudes: { pendientes: 0, ultimas: [] },
      padron: { total: 1, sin_placa: 1, vigentes: 1, por_vencer: 0, vencidos: 0, por_iniciar: 0, con_horario: 0, dias_aviso: 7 },
    } : [{ id: 7, placa: null, propietario: 'María Pérez', vigente: true, ingresos: 0, fecha_registro: '2026-10-22T15:00:00Z' }] }));
    render(<MemoryRouter initialEntries={['/gestion-permisos?pestana=sin_permiso&usuarioId=99']}><GestionPermisos /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('María Pérez')).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith('/vehiculos-autorizados/mis-permisos');
    expect(screen.getByText('Pendiente de placa')).toBeInTheDocument();
    for (const nombre of ['ID', 'Nombres y apellidos', 'Cédula', 'Institución', 'Cargo', 'Placa', 'Marca', 'Modelo', 'Tipo', 'Color']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument();
    }
    expect(screen.queryByText('Placas sin permiso')).not.toBeInTheDocument();
    expect(screen.queryByText('Accesos denegados recientes')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('/vehiculos-autorizados');
  });
});
