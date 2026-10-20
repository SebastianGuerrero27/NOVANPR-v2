/**
 * Cámara de prueba con un video: el navegador comprueba la firma antes de subir (un archivo que no
 * es video no se envía) y la carga lleva el archivo crudo con su tipo y los datos en la consulta.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({
  default: { post },
  mensajeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { CargarVideo } from '../src/interfaz/componentes/CargarVideo';
import { Placa } from '../src/interfaz/componentes/ui';
import { formatoPorFirma, nombreDesdeArchivo } from '../src/dominio/videoPrueba';

const MP4 = new Uint8Array([0, 0, 0, 0x20, ...Array.from('ftypisom', c => c.charCodeAt(0)), 0, 0, 2, 0, 9, 9, 9]);
const archivo = (bytes: Uint8Array, nombre: string, tipo = 'video/mp4') => new File([bytes as BlobPart], nombre, { type: tipo });

afterEach(() => { post.mockReset(); });

describe('Video de prueba · reglas', () => {
  it('reconoce el formato por la firma y propone el nombre de la cámara', () => {
    expect(formatoPorFirma(MP4)).toBe('mp4');
    expect(formatoPorFirma(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('mkv');
    expect(formatoPorFirma(new TextEncoder().encode('<html>no es video</html>'))).toBeNull();
    expect(nombreDesdeArchivo('ENTRADA_ECU_001_2026-10-19-07-40-44_2026-10-19-08-10-45.mp4')).toBe('ENTRADA ECU 001 2026-10-19');
    expect(nombreDesdeArchivo('a.mp4')).toBe('Video de prueba');
  });

  it('un paso sin placa se muestra como «Sin placa», no como una lectura fallida', () => {
    render(<><Placa valor={null} sinPlaca /><Placa valor={null} /></>);
    expect(screen.getByText('Sin placa')).toBeInTheDocument();
    expect(screen.getByText('Sin lectura')).toBeInTheDocument();
  });
});

describe('Video de prueba · carga', () => {
  const elegir = (f: File) => fireEvent.change(screen.getByLabelText('Archivo de video'), { target: { files: [f] } });

  it('un archivo que no es video no se sube', async () => {
    render(<CargarVideo onCerrar={() => undefined} onCargada={() => undefined} />);
    elegir(archivo(new TextEncoder().encode('<html>falso video</html>'), 'video.mp4'));
    expect(await screen.findByText('El archivo no es un video MP4, MKV o MOV.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cargar y crear cámara/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('sube el archivo crudo con su tipo y los datos de la cámara, y entrega la cámara creada', async () => {
    const camara = { id: 9, nombre: 'ENTRADA ECU 001 2026-10-19', es_video: true };
    post.mockResolvedValue({ data: { camera: camara } });
    const onCargada = vi.fn();
    render(<CargarVideo onCerrar={() => undefined} onCargada={onCargada} />);
    const f = archivo(MP4, 'ENTRADA_ECU_001_2026-10-19-07-40-44.mp4', '');
    elegir(f);
    await waitFor(() => expect(screen.getByLabelText(/Nombre de la cámara/)).toHaveValue('ENTRADA ECU 001 2026-10-19'));
    fireEvent.click(screen.getByRole('button', { name: /Cargar y crear cámara/ }));
    await waitFor(() => expect(onCargada).toHaveBeenCalledWith(camara));
    expect(post).toHaveBeenCalledWith('/camaras/video-prueba', f, expect.objectContaining({
      params: { nombre: 'ENTRADA ECU 001 2026-10-19', ubicacion: 'Video de prueba', direccion: 'ingreso' },
      headers: { 'Content-Type': 'video/mp4' },
      timeout: 0,
    }));
  });
});
