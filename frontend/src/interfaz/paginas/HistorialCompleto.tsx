import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CarFront, Download, LogOut, Search, X } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useDiferido, useRetardado } from '../../aplicacion/hooks';
import type { Camara, Deteccion, Pagina } from '../../dominio/tipos';
import { fecha, fechaIsoLocal, hora, limiteDia, nombreDescarga, numero } from '../../dominio/formato';
import { ESTADOS_ACCESO, estadoAcceso } from '../../dominio/estadoAcceso';
import { formatearPlaca } from '../../dominio/validacion';
import { descargarBlob } from '../../infraestructura/descargas';
import { Aviso, FilasEsqueleto, InsigniaEstado, Paginacion, Tarjeta, Vacio } from '../componentes/ui';
import { PlacaFoto } from '../componentes/deteccion';
import { VisorZoom } from '../componentes/ZoomDual';
import { SelectorPeriodo } from '../componentes/SelectorPeriodo';
import { useNotificar } from '../componentes/Notificaciones';

/**
 * Historial completo: todos los pasos registrados (autorizados, no autorizados, lista negra,
 * pendientes, con y sin salida), consultados por fechas. Por omisión muestra el día de hoy; se
 * puede buscar una placa o un nombre y filtrar por estado. Se actualiza en tiempo real.
 * Registro de Salidas (/detecciones) conserva solo los registros completos con salida.
 *
 * Los filtros viven en la URL: los enlaces de otras pantallas llegan con ?placa= o ?camara=.
 */

const ESTADOS: Record<string, { etiqueta: string; estado?: string }> = {
  '': { etiqueta: 'Todos los estados' },
  autorizados: { etiqueta: 'Autorizados', estado: 'autorizado' },
  no_autorizados: { etiqueta: 'No autorizados', estado: 'no_reconocido,alerta' },
  alertas: { etiqueta: 'Lista negra', estado: 'alerta' },
  pendientes: { etiqueta: 'Pendientes de autorización', estado: 'pendiente_revision' },
};
const TAMANO = 50;

const vehiculo = (d: Deteccion) => [d.vehiculo?.tipo ?? d.tipo_vehiculo, [d.vehiculo?.marca, d.vehiculo?.modelo].filter(Boolean).join(' '), d.vehiculo?.color]
  .filter(Boolean).join(' · ');

const HistorialCompleto: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notificar = useNotificar();
  const hoy = fechaIsoLocal();
  const placa = params.get('placa') ?? '';
  const camara = params.get('camara') ?? '';
  const estado = ESTADOS[params.get('estado') ?? ''] ? params.get('estado') ?? '' : '';
  // Sin fechas en la URL: el día de hoy, salvo que se llegue a consultar una placa, una cámara o «Todo»
  const porOmision = !placa && !camara && !params.get('buscar') && !params.has('todo');
  const desde = params.get('desde') ?? (porOmision ? hoy : '');
  const hasta = params.get('hasta') ?? (porOmision ? hoy : '');
  const pagina = Math.max(1, Number(params.get('pagina') ?? 1) || 1);
  const [texto, setTexto] = useState(() => params.get('buscar') ?? '');
  const buscar = useRetardado(texto.trim(), 400);
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const [exportando, setExportando] = useState(false);

  const cambiar = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); }
    if (!('pagina' in cambios)) p.delete('pagina');
    setParams(p, { replace: true });
  };
  useEffect(() => { if ((params.get('buscar') ?? '') !== buscar) cambiar({ buscar: buscar || undefined }); }, [buscar]); // eslint-disable-line react-hooks/exhaustive-deps

  const consulta = {
    desde: desde ? limiteDia(desde) : undefined, hasta: hasta ? limiteDia(hasta, true) : undefined,
    placa: placa || undefined, camara: camara || undefined, buscar: params.get('buscar') || undefined, estado: ESTADOS[estado].estado,
  };
  const clave = JSON.stringify(consulta);
  const { datos, cargando, error, recargar } = useConsulta<Pagina<Deteccion>>(
    () => api.get('/detecciones', { params: { ...consulta, pagina, tamano: TAMANO } }).then(r => r.data), [clave, pagina]);
  const { datos: camaras } = useConsulta<Camara[]>(() => (camara ? api.get('/camaras').then(r => r.data) : Promise.resolve([])), [camara]);

  // En vivo: un paso nuevo o actualizado recarga la página actual sin mover la tabla
  const recargarDiferido = useDiferido(() => recargar(true), 1500);
  useEvento('deteccion:nueva', recargarDiferido);
  useEvento('deteccion:actualizada', recargarDiferido);
  useEvento('deteccion:eliminada', recargarDiferido);
  useEvento('deteccion:eliminadas', recargarDiferido);
  useReconexion(recargarDiferido);

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await api.get('/detecciones/exportar', { params: consulta, responseType: 'blob' });
      descargarBlob(r.data, nombreDescarga(r.headers['content-disposition'], 'historial_anpr.csv'));
    } catch (e) {
      notificar('error', 'No se pudo exportar', mensajeError(e));
    } finally { setExportando(false); }
  };

  const periodo = !desde && !hasta ? 'todo el historial' : desde === hasta ? `el ${fecha(`${desde}T12:00:00-05:00`)}`
    : `del ${desde ? fecha(`${desde}T12:00:00-05:00`) : 'inicio'} al ${hasta ? fecha(`${hasta}T12:00:00-05:00`) : 'día de hoy'}`;
  const nombreCamara = camara ? camaras?.find(c => String(c.id) === camara)?.nombre ?? `#${camara}` : '';

  return (
    <div className="pagina">
      <div className="encabezado-pagina">
        <div>
          <h2>Historial completo</h2>
          <p>Todos los ingresos registrados. Elija las fechas y, si lo necesita, una placa, un nombre o un estado.</p>
        </div>
        <div className="fila">
          <Link to="/detecciones" className="btn btn-secondary"><LogOut size={15} /> Registro de Salidas</Link>
          <button className="btn btn-navy" onClick={exportar} disabled={exportando || !datos?.total}><Download size={15} /> {exportando ? 'Exportando…' : 'Exportar a Excel (CSV)'}</button>
        </div>
      </div>

      <div className="pila">
        <Tarjeta>
          <div className="filtros">
            <SelectorPeriodo prefijo="h" desde={desde} hasta={hasta} todo
              onCambiar={(d, h) => cambiar({ desde: d || undefined, hasta: h || undefined, todo: !d && !h ? '1' : undefined })} />
            <div className="campo crece" style={{ maxWidth: 300 }}>
              <label htmlFor="h-buscar">Placa, nombre o cédula</label>
              <div className="input-icono"><Search size={15} />
                <input id="h-buscar" className="input" value={texto} onChange={e => setTexto(e.target.value)} maxLength={100} placeholder="Ej.: PBA-1234 o María Pérez" autoComplete="off" />
              </div>
            </div>
            <div className="campo">
              <label htmlFor="h-estado">Estado</label>
              <select id="h-estado" className="select" value={estado} onChange={e => cambiar({ estado: e.target.value || undefined })}>
                {Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{e.etiqueta}</option>)}
              </select>
            </div>
          </div>
          {(placa || camara) && (
            <div className="fila" style={{ gap: 6, marginTop: 12 }}>
              {placa && <span className="chip-filtro">Placa {formatearPlaca(placa)}
                <button type="button" aria-label="Quitar el filtro de placa" onClick={() => cambiar({ placa: undefined })}><X size={12} /></button></span>}
              {camara && <span className="chip-filtro">Cámara {nombreCamara}
                <button type="button" aria-label="Quitar el filtro de cámara" onClick={() => cambiar({ camara: undefined })}><X size={12} /></button></span>}
            </div>
          )}
        </Tarjeta>

        {error && <Aviso tipo="error">{error}</Aviso>}

        <Tarjeta titulo={datos ? `${numero(datos.total)} ${datos.total === 1 ? 'registro' : 'registros'}` : 'Registros'}
          subtitulo={`Ingresos de ${periodo}${estado ? ` · ${ESTADOS[estado].etiqueta.toLowerCase()}` : ''} · pulse una fila para ver la evidencia`} sinPadding>
          <div className="tabla-contenedor" role="region" aria-label="Tabla del historial completo" tabIndex={0}>
            <table className="tabla">
              <thead><tr>
                <th className="num">N.º</th><th>Fecha</th><th>Ingreso</th><th>Salida</th><th>Placa</th><th>Persona</th><th>Vehículo</th><th>Motivo</th><th>Estado</th>
              </tr></thead>
              <tbody>
                {cargando && !datos ? <FilasEsqueleto columnas={9} /> : datos?.items.map((d, i) => (
                  <tr key={d.id} className={`clic ${ESTADOS_ACCESO[estadoAcceso(d)].clase}`} tabIndex={0}
                    onClick={() => navigate(`/detecciones/${d.id}`)} onKeyDown={e => { if (e.key === 'Enter') navigate(`/detecciones/${d.id}`); }}>
                    <td className="num texto-secundario">{(pagina - 1) * TAMANO + i + 1}</td>
                    <td className="nowrap">{fecha(d.fecha_hora_ingreso)}</td>
                    <td className="nowrap"><strong>{hora(d.fecha_hora_ingreso)}</strong></td>
                    <td className="nowrap">{d.fecha_hora_salida ? hora(d.fecha_hora_salida) : <span className="texto-secundario">—</span>}</td>
                    <td className="nowrap" onClick={e => e.stopPropagation()}><PlacaFoto d={d} alto={32} onClick={() => setZoom(d)} /></td>
                    <td>{d.persona_ingreso || d.autorizado?.propietario || <span className="texto-secundario">—</span>}</td>
                    <td>{vehiculo(d) || <span className="texto-secundario">—</span>}</td>
                    <td className="truncar" style={{ maxWidth: 220 }} title={d.motivo_ingreso ?? ''}>{d.motivo_ingreso || <span className="texto-secundario">—</span>}</td>
                    <td className="nowrap"><InsigniaEstado estado={d.estado_validacion} procesando={d.estado_procesamiento === 'pendiente_ocr'} corta /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos && datos.items.length === 0 && (
            <Vacio titulo="Sin registros" icono={<CarFront size={22} />}
              texto={`No hay ingresos ${periodo === 'todo el historial' ? 'registrados' : `de ${periodo}`} con los filtros elegidos. Pruebe con otras fechas o «Todo».`} />
          )}
          {datos && datos.total > 0 && <Paginacion pagina={datos.pagina} tamano={datos.tamano} total={datos.total} onCambiar={p => cambiar({ pagina: String(p) })} />}
        </Tarjeta>
      </div>
      {zoom && <VisorZoom d={zoom} onCerrar={() => setZoom(null)} />}
    </div>
  );
};

export default HistorialCompleto;
