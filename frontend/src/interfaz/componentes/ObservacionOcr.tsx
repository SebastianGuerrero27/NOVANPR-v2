import type { EvidenciaTextoOcr } from '../../dominio/tipos';

/** Texto de un rótulo conservado por el motor sin asignarlo como matrícula. */
export const ObservacionOcr: React.FC<{ evidencia?: EvidenciaTextoOcr | null }> = ({ evidencia }) => {
  const texto = typeof evidencia?.observacion_ocr === 'string' ? evidencia.observacion_ocr.trim() : '';
  if (!texto) return null;
  return <span className="secundario texto-secundario" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>
    <strong>Observación OCR:</strong> {texto}
  </span>;
};
