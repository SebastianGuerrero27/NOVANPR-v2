/** El permiso de la lista blanca guarda el motivo habitual de ingreso (datos ficticios). */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { post, get: vi.fn().mockResolvedValue({ data: {} }) }, mensajeError: String, urlMedia: (r: string) => r }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => true }) }));
import { FormularioLista } from '../src/interfaz/componentes/FormularioLista';

it('se elige un motivo frecuente con un toque, queda marcado y se guarda con el permiso', async () => {
  post.mockResolvedValue({ data: { item: { id: 9 } } });
  const onGuardado = vi.fn();
  render(<FormularioLista tipo="autorizados" onCerrar={vi.fn()} onGuardado={onGuardado} />);
  fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'Ana Torres Paz' } });
  const opcion = screen.getByRole('button', { name: 'Jornada laboral' });
  fireEvent.click(opcion);
  expect(opcion).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Motivo de ingreso')).toHaveValue('Jornada laboral');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/vehiculos-autorizados', expect.objectContaining({ propietario: 'Ana Torres Paz', motivo_ingreso: 'Jornada laboral' })));
  expect(onGuardado).toHaveBeenCalled();
});
