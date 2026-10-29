import React, { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { formatearPlaca } from '../../dominio/validacion';
import { Aviso, Modal } from './ui';

/** Respuesta de POST /vehiculos-autorizados/importar (vista previa o importación). */
interface ResultadoImportacion {
  simulacion: boolean;
  archivo: string;
  resumen: { total: number; crear: number; reactivar: number; omitir: number; error: number };
  filas: { fila: number; id: string | null; propietario: string | null; placa: string | null; accion: 'crear' | 'reactivar' | 'omitir' | 'error'; mensaje: string }[];
}

const ACCION: Record<ResultadoImportacion['filas'][number]['accion'], { texto: string; clase: string }> = {
  crear: { texto: 'Nuevo', clase: 'autorizado' }, reactivar: { texto: 'Reactivar', clase: 'info' },
  omitir: { texto: 'Ya existe', clase: 'neutro' }, error: { texto: 'Error', clase: 'alerta' },
};
const MAX_MB = 5;

/**
 * Importa permisos de la lista blanca desde Excel (.xlsx) o CSV con el formato de la garita:
 * id, nombres, cedula, institucion, cargo, placa, marca, modelo, tipo, color. El id solo identifica
 * la fila (no se guarda). Primero se muestra la vista previa (el servidor valida cada fila sin
 * guardar) y solo después de confirmar se importan; los permisos quedan a nombre de quien importa.
 */
export const ImportarPermisos: React.FC<{ onCerrar: () => void; onImportado: (r: ResultadoImportacion) => void }> = ({ onCerrar, onImportado }) => {
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<ResultadoImportacion | null>(null);
  const [final, setFinal] = useState<ResultadoImportacion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (f: File, simular: boolean) => {
    const r = await api.post<ResultadoImportacion>('/vehiculos-autorizados/importar', f, {
      params: { simular: simular ? 'si' : undefined, archivo: f.name }, headers: { 'Content-Type': 'application/octet-stream' },
    });
    return r.data;
  };

  const elegir = async (f: File | undefined) => {
    setError(null); setPrevia(null); setFinal(null); setArchivo(f ?? null);
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) { setError('Seleccione un archivo .xlsx (Excel) o .csv.'); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`El archivo supera ${MAX_MB} MB.`); return; }
    setEnviando(true);
    try { setPrevia(await enviar(f, true)); } catch (e) { setError(mensajeError(e)); } finally { setEnviando(false); }
  };

  const importar = async () => {
    if (!archivo) return;
    setEnviando(true); setError(null);
    try {
      const r = await enviar(archivo, false);
      setFinal(r);
      onImportado(r);
    } catch (e) { setError(mensajeError(e)); } finally { setEnviando(false); }
  };

  const mostrado = final ?? previa;
  const aImportar = previa ? previa.resumen.crear + previa.resumen.reactivar : 0;
  return (
    <Modal titulo="Importar permisos desde Excel" tamano="ancho" onCerrar={onCerrar} bloquear={enviando}
      subtitulo="Columnas: id, nombres, cedula, institucion, cargo, placa, marca, modelo, tipo, color · el id solo identifica la fila y no se guarda"
      pie={final
        ? <button className="btn btn-navy" onClick={onCerrar}>Listo</button>
        : <>
          <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button className="btn btn-navy" onClick={importar} disabled={enviando || !aImportar}>
            {enviando ? <Loader2 size={14} className="girar" /> : <Upload size={14} />} {aImportar ? `Importar ${aImportar} ${aImportar === 1 ? 'permiso' : 'permisos'}` : 'Importar'}
          </button>
        </>}>
      <div className="pila" style={{ gap: 12 }}>
        {!final && (
          <div className="fila" style={{ gap: 10 }}>
            <input ref={entrada} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden
              onChange={e => { void elegir(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="btn btn-secondary" onClick={() => entrada.current?.click()} disabled={enviando}>
              <FileSpreadsheet size={15} /> {archivo ? 'Elegir otro archivo' : 'Elegir archivo .xlsx o .csv'}
            </button>
            {archivo && <span className="texto-secundario">{archivo.name}</span>}
            {enviando && <span className="texto-secundario" role="status"><Loader2 size={13} className="girar" /> {previa ? 'Importando…' : 'Revisando el archivo…'}</span>}
          </div>
        )}
        {!archivo && !error && (
          <Aviso tipo="info">La primera fila debe tener los encabezados. Cada fila se valida como el formulario: una placa que ya está en la lista blanca
            no se modifica, una retirada se reactiva y las filas con errores se informan sin detener a las demás. Antes de guardar verá una vista previa.</Aviso>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        {final && <Aviso tipo="exito"><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> Importación terminada: {final.resumen.crear} creados, {final.resumen.reactivar} reactivados, {final.resumen.omitir} ya existían y {final.resumen.error} con error. Queda registrada en la auditoría.</Aviso>}
        {mostrado && (
          <>
            {!final && (
              <div className="importacion-resumen" aria-label="Resumen de la vista previa">
                <span>{mostrado.resumen.total} filas</span>
                <span style={{ color: 'var(--autorizado)' }}>{mostrado.resumen.crear} nuevos</span>
                <span style={{ color: 'var(--pendiente)' }}>{mostrado.resumen.reactivar} se reactivan</span>
                <span>{mostrado.resumen.omitir} ya existen</span>
                <span style={{ color: 'var(--alerta)' }}>{mostrado.resumen.error} con error</span>
              </div>
            )}
            <div className="tabla-contenedor" style={{ maxHeight: 360 }}>
              <table className="tabla compacta importacion-tabla">
                <thead><tr><th className="num">Fila</th><th>Id</th><th>Nombres</th><th>Placa</th><th>Resultado</th><th>Detalle</th></tr></thead>
                <tbody>
                  {mostrado.filas.map(f => (
                    <tr key={f.fila} className={f.accion === 'error' ? 'fila-sin-lectura' : ''}>
                      <td className="num texto-secundario">{f.fila}</td>
                      <td className="texto-secundario">{f.id ?? '—'}</td>
                      <td>{f.propietario ?? '—'}</td>
                      <td className="nowrap">{f.placa ? formatearPlaca(f.placa) : <span className="texto-secundario">Por nombre</span>}</td>
                      <td><span className={`insignia ${ACCION[f.accion].clase}`}>{ACCION[f.accion].texto}</span></td>
                      <td className="texto-secundario">{f.mensaje}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
