import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DeteccionDetalle } from '../src/dominio/tipos';

vi.mock('../src/infraestructura/api', () => ({
  default: { get: vi.fn() }, mensajeError: String, respuestaError: () => null,
  urlMedia: (ruta: string | null) => ruta,
}));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => false }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import api from '../src/infraestructura/api';
import { PlacaFoto } from '../src/interfaz/componentes/deteccion';
import { ObservacionOcr } from '../src/interfaz/componentes/ObservacionOcr';
import DetalleDeteccion from '../src/interfaz/paginas/DetalleDeteccion';

const ev = { motivo: 'texto_no_matricula', observacion_ocr: 'HAVAL / ambacar', confianza_texto_ocr: 0.99,
  candidata_descartada: 'QIH-6060', valido: false, formato: false, dentro_cuadro: true,
  caracteres: 0, lecturas: 0, verificador_coincide: false };
const deteccion: DeteccionDetalle = {
  id: 15, placa: null, placa_reconocida: null, placa_validada: null,
  estado_validacion: 'pendiente_revision', estado_procesamiento: 'no_legible', confianza_deteccion: 0.9,
  confianza_ocr: 0, fecha_hora_ingreso: '2026-10-27T16:00:00Z', fecha_hora_procesamiento: null,
  tipo_movimiento: 'ingreso', fuente: 'rtsp', tracking_id: 5,
  imagen_placa: '/media/rotulo.jpg', imagen_vehiculo: '/media/vehiculo.jpg', camara: null,
  tipo_vehiculo: null, vehiculo: { tipo: null, marca: null, modelo: null, color: null },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, lectura_valida: false, motivo_ingreso: 'Jornada laboral',
  evidencia_lectura: ev,
  lectura_automatica: { placa: null, confianza: 0, decision: 'pendiente_revision', verificador: null,
    latencia_ms: null, modelo_detector: null, modelo_ocr: null, valida: false, evidencia: ev },
  captura: { luminancia_media: null, distancia_estimada_m: null, ancho_placa_px: null,
    nitidez: null, velocidad_px_s: null, condicion_clima: null }, auditoria: [], pasos_anteriores: [],
};

describe('Texto general observado por OCR', () => {
  it('la celda conserva foto y ausencia de matrícula; el rótulo tiene su propia etiqueta', () => {
    render(<PlacaFoto d={deteccion} />);
    expect(screen.getByText('Sin lectura')).toBeInTheDocument();
    expect(screen.getByText('Observación OCR:')).toBeInTheDocument();
    expect(screen.getByText('HAVAL / ambacar')).toBeInTheDocument();
    expect(screen.getByAltText('Placa sin lectura')).toHaveAttribute('src', '/media/rotulo.jpg');
    expect(screen.queryByText('QIH-6060')).not.toBeInTheDocument();
  });

  it('el detalle muestra una sola observación OCR, separada del motivo del ingreso y de la placa', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: deteccion });
    render(<MemoryRouter initialEntries={['/detecciones/15']}><Routes>
      <Route path="/detecciones/:id" element={<DetalleDeteccion />} />
    </Routes></MemoryRouter>);
    const titulo = await screen.findByText('Lectura automática y verificación');
    const tarjeta = titulo.closest('.tarjeta')!;
    expect(within(tarjeta as HTMLElement).getByText('HAVAL / ambacar')).toBeInTheDocument();
    expect(screen.getAllByText('Observación OCR:')).toHaveLength(1);
    expect(screen.getByText('Jornada laboral')).toBeInTheDocument();
    expect(screen.queryByText('QIH-6060')).not.toBeInTheDocument();
    expect(screen.getByText('El motor leyó un rótulo y conservó su texto como observación, sin asignarlo como matrícula.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Formato oficial ANT')).not.toBeInTheDocument();
  });

  it('sin texto OCR no agrega observaciones y mantiene una matrícula reconocida', () => {
    const { container } = render(<ObservacionOcr evidencia={{ observacion_ocr: ' ' }} />);
    expect(container).toBeEmptyDOMElement();
    render(<PlacaFoto d={{ ...deteccion, placa: 'PBA1234', evidencia_lectura: null }} />);
    expect(screen.getByText('PBA-1234')).toBeInTheDocument();
    expect(screen.queryByText('Observación OCR:')).not.toBeInTheDocument();
  });
});
