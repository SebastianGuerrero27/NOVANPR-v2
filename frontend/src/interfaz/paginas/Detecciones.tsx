import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Edit3, FileText, Filter, History, RefreshCw, Search, Trash2, X } from 'lucide-react';
import api, { mensajeError, mensajeErrorDescarga } from '../../infraestructura/api';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useRetardado } from '../../aplicacion/hooks';
import type { Camara, Deteccion, Pagina } from '../../dominio/tipos';
import { fecha, hora, limiteDia, nombreDescarga } from '../../dominio/formato';
import { ESTADOS_ACCESO, estadoAcceso } from '../../dominio/estadoAcceso';
import { descargarBlob } from '../../infraestructura/descargas';
import { normalizarPlaca } from '../../dominio/validacion';
import { Aviso, FilasEsqueleto, InsigniaEstado, Paginacion, Tarjeta, Vacio } from '../componentes/ui';
import { filtrarEscrito } from '../componentes/campos';
import { PlacaFoto, ValidarModal } from '../componentes/deteccion';
import { CeldaIngreso, actualizarCampoIngreso, type CampoIngreso } from '../componentes/CeldaIngreso';
import { ConfianzaRegistro } from '../componentes/ConfianzaRegistro';
import { VisorZoom } from '../componentes/ZoomDual';

import { EliminarUno, EliminarVarios } from '../componentes/EliminarDetecciones';
import { useAuth } from '../../aplicacion/AuthContext';
import { useNotificar } from '../componentes/Notificaciones';

const Detecciones: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notificar = useNotificar();


  const [eliminando, setEliminando] = useState<Deteccion | null>(null);
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const [editando, setEditando] = useState<Deteccion | null>(null);
  const [eliminarVarios, setEliminarVarios] = useState(false);
  const { puede } = useAuth();
  const esAdmin = puede('detecciones:eliminar');
  const puedeEditarCampos = puede('detecciones:validar');
  const tieneAcciones = puedeEditarCampos || esAdmin;
  const [exportando, setExportando] = useState(false);
  const [nuevos, setNuevos] = useState(0);
  const [placaTexto, setPlacaTexto] = useState(() => normalizarPlaca(params.get('placa')).slice(0, 10));
  const placa = useRetardado(placaTexto, 400);

  const filtros = {
    estado: params.get('estado') ?? '',
    camara: params.get('camara') ?? '',
    desde: params.get('desde') ?? '',
    hasta: params.get('hasta') ?? '',
    validado: params.get('validado') ?? '',
    pagina: Number(params.get('pagina') ?? 1),
  };
  const cambiar = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    if (k !== 'pagina') p.delete('pagina');
    setParams(p, { replace: true });
  };
  React.useEffect(() => { if ((params.get('placa') ?? '') !== placa) cambiar('placa', placa); }, [placa]); // eslint-disable-line react-hooks/exhaustive-deps

  const consultaParams = useMemo(() => ({
    cerrados: 'si',
    completos: 'si',
    placa: params.get('placa') || undefined,
    estado: filtros.estado || undefined,
    camara: filtros.camara || undefined,
    validado: filtros.validado || undefined,
    desde: filtros.desde ? limiteDia(filtros.desde) : undefined,
    hasta: filtros.hasta ? limiteDia(filtros.hasta, true) : undefined,
  }), [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const { datos, cargando, error, recargar, setDatos } = useConsulta<Pagina<Deteccion>>(
    () => api.get('/detecciones', { params: { ...consultaParams, pagina: filtros.pagina, tamano: 25 } }).then(r => r.data),
    [consultaParams, filtros.pagina]);
  const { datos: camaras } = useConsulta<Camara[]>(() => api.get('/camaras').then(r => r.data), []);
  const alEditar = (actualizada: Deteccion, campo?: CampoIngreso) => {
    setDatos(actuales => actuales && { ...actuales, items: actuales.items.map(d => d.id === actualizada.id ? actualizarCampoIngreso(d, actualizada, campo) : d) });
  };

  // En vivo: las filas visibles se actualizan; los ingresos nuevos se anuncian sin mover la tabla
  const anunciados = useRef(new Set<number>());
  const olvidarAnunciados = () => { anunciados.current.clear(); setNuevos(0); };
  useEvento<Deteccion>('deteccion:nueva', d => { if (!d.registro_completo || d.tipo_movimiento === 'salida') return; anunciados.current.add(d.id); setNuevos(anunciados.current.size); });
  useEvento<Deteccion>('deteccion:actualizada', () => recargar(true));
  // Un ingreso eliminado (o consolidado con su paso previo) sale de la tabla y del total solo si se
  // estaba mostrando, y del aviso si se había anunciado: los demás nunca se contaron aquí
  useEvento<{ id: number }>('deteccion:eliminada', ({ id }) => {
    if (anunciados.current.delete(id)) setNuevos(anunciados.current.size);
    setDatos(p => p && (p.items.some(x => x.id === id) ? { ...p, items: p.items.filter(x => x.id !== id), total: p.total - 1 } : p));
  });
  useEvento('deteccion:eliminadas', () => { olvidarAnunciados(); recargar(true); });
  useReconexion(() => recargar(true));

  const hayFiltros = Boolean(params.get('placa') || filtros.estado || filtros.camara || filtros.desde || filtros.hasta || filtros.validado);

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await api.get('/detecciones/exportar', { params: consultaParams, responseType: 'blob' });
      descargarBlob(r.data, nombreDescarga(r.headers['content-disposition'], 'ingresos_anpr.csv'));
      notificar('exito', 'Exportación generada', 'El archivo CSV se descargó con los filtros aplicados.');
    } catch (e) {
      notificar('error', 'No se pudo exportar', mensajeError(e));
    } finally {
      setExportando(false);
    }
  };

  const exportarPdf = async () => {
    setExportando(true);
    try {
      const r = await api.get('/detecciones/registros.pdf', { params: consultaParams, responseType: 'blob' });
      descargarBlob(r.data, nombreDescarga(r.headers['content-disposition'], 'registros.pdf'));
    } catch (e) {
      notificar('error', 'No se pudo generar el PDF', await mensajeErrorDescarga(e));
    } finally { setExportando(false); }
  };

  return (
    <div className="pagina">
      <div className="pila">
        <Tarjeta>
          <div className="filtros">
            <div className="campo crece">
              <label htmlFor="f-placa">Placa</label>
              <div className="input-icono"><Search size={15} />
                {/* Búsqueda parcial: solo letras y números, sin exigir el formato completo */}
                <input id="f-placa" className="input placa-input" value={placaTexto} onChange={e => setPlacaTexto(filtrarEscrito(e.target, normalizarPlaca))}
                  placeholder="Buscar placa" maxLength={10} autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <div className="campo">
              <label htmlFor="f-camara">Cámara</label>
              <select id="f-camara" className="select" value={filtros.camara} onChange={e => cambiar('camara', e.target.value)}>
                <option value="">Todas</option>
                {camaras?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="f-validado">Validación</label>
              <select id="f-validado" className="select" value={filtros.validado} onChange={e => cambiar('validado', e.target.value)}>
                <option value="">Todas</option>
                <option value="si">Confirmadas por el personal</option>
                <option value="no">Solo automáticas</option>
              </select>
            </div>
            <div className="campo" style={{ minWidth: 140 }}>
              <label htmlFor="f-desde">Desde</label>
              <input id="f-desde" type="date" className="input" value={filtros.desde} max={filtros.hasta || undefined} onChange={e => cambiar('desde', e.target.value)} />
            </div>
            <div className="campo" style={{ minWidth: 140 }}>
              <label htmlFor="f-hasta">Hasta</label>
              <input id="f-hasta" type="date" className="input" value={filtros.hasta} min={filtros.desde || undefined} onChange={e => cambiar('hasta', e.target.value)} />
            </div>
            {hayFiltros && <button className="btn btn-ghost" onClick={() => { setPlacaTexto(''); setParams({}, { replace: true }); }}><X size={15} /> Limpiar</button>}
          </div>
        </Tarjeta>

        {nuevos > 0 && (
          <Aviso tipo="info">
            <span className="fila" style={{ justifyContent: 'space-between', width: '100%' }}>
              {nuevos === 1 ? 'Se cerró 1 registro.' : `Se registraron ${nuevos} registros con salida.`}
              <button className="btn btn-sm btn-secondary" onClick={() => { olvidarAnunciados(); cambiar('pagina', ''); recargar(); }}><RefreshCw size={13} /> Mostrar</button>
            </span>
          </Aviso>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}

        <Tarjeta titulo="Registros completos con salida" subtitulo={datos ? `${datos.total.toLocaleString('es-EC')} registros${hayFiltros ? ' con los filtros aplicados' : ''} · Nombre, placa, tipo, marca, motivo e ingreso y salida válidos` : undefined}
          acciones={<>
            <Link to="/historial" className="btn btn-ghost btn-sm"><History size={14} /> Historial completo</Link>
            <button className="btn btn-navy btn-sm" onClick={exportarPdf} disabled={exportando || !datos?.total}><FileText size={14} /> {exportando ? 'Generando…' : 'Descargar PDF'}</button>
            <button className="btn btn-secondary btn-sm" onClick={exportar} disabled={exportando || !datos?.total}><Download size={14} /> {exportando ? 'Exportando…' : 'Exportar CSV'}</button>
            {esAdmin && <button className="btn btn-danger btn-sm" onClick={() => setEliminarVarios(true)} disabled={!datos?.total}>
              <Trash2 size={14} /> {hayFiltros ? 'Eliminar filtrados' : 'Eliminar todos'}</button>}
          </>}
          sinPadding>
          <div className="tabla-contenedor" role="region" aria-label="Tabla de registros completos" tabIndex={0}>
            <table className="tabla tabla-registros">
              <thead><tr>
                <th className="num">N.º</th><th>Cédula</th><th>Titular</th><th>Placa</th><th>Motivo</th><th>Fecha</th><th>Hora de entrada</th><th>Hora de salida</th>
                <th>Vehículo</th><th>Marca</th><th>Modelo</th><th>Cámara</th><th>Estado</th><th>Confianza</th>
                <th>Registro de salida</th>{tieneAcciones && <th className="columna-acciones">Acciones</th>}
              </tr></thead>
              <tbody>
                {cargando && !datos ? <FilasEsqueleto columnas={tieneAcciones ? 16 : 15} /> : datos?.items.map((d, i) => (
                  <tr key={d.id} className={`clic ${ESTADOS_ACCESO[estadoAcceso(d)].clase}`} onClick={() => navigate(`/detecciones/${d.id}`)}>
                    <td className="num texto-secundario">{(filtros.pagina - 1) * (datos?.tamano ?? 25) + i + 1}</td>
                    <CeldaIngreso d={d} campo="cedula" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <CeldaIngreso d={d} campo="persona_ingreso" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <td className="nowrap">
                      <PlacaFoto d={d} alto={36} onClick={() => setZoom(d)} />
                    </td>
                    <CeldaIngreso d={d} campo="motivo_ingreso" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <td className="nowrap">{fecha(d.fecha_hora_ingreso)}</td>
                    <td className="nowrap"><strong>{hora(d.fecha_hora_ingreso)}</strong></td>
                    <td className="nowrap">{d.fecha_hora_salida ? hora(d.fecha_hora_salida) : '—'}</td>
                    <CeldaIngreso d={d} campo="tipo_vehiculo" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <CeldaIngreso d={d} campo="marca" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <CeldaIngreso d={d} campo="modelo" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <td>{d.camara?.nombre || 'Registro manual'}</td>
                    <td className="nowrap"><InsigniaEstado estado={d.estado_validacion} corta /></td>
                    <td className="nowrap"><ConfianzaRegistro valor={d.confianza_ocr} /></td>
                    <td className="nowrap">{d.fecha_hora_salida ? 'Registrada' : '—'}</td>
                    {tieneAcciones && <td className="acciones-celda" onClick={e => e.stopPropagation()}><div className="acciones-registro">
                      {puedeEditarCampos && <button className="btn btn-ghost btn-sm btn-icono" title="Editar registro" aria-label="Editar registro" onClick={() => setEditando(d)}><Edit3 size={14} /></button>}
                      {esAdmin && <button className="btn btn-ghost btn-sm btn-icono" title="Eliminar registro" aria-label="Eliminar registro" onClick={() => setEliminando(d)}><Trash2 size={15} color="var(--alerta)" /></button>}
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos && datos.items.length === 0 && (
            <Vacio titulo={hayFiltros ? 'Sin resultados' : 'Aún no hay registros completos con salida'} icono={hayFiltros ? <Filter size={22} /> : undefined}
              texto={hayFiltros ? 'Ningún registro completo con salida coincide con los filtros.' : 'Se requiere nombre, placa, tipo, marca, motivo y fechas de ingreso y salida válidas. Los incompletos permanecen en Movimientos recientes para completarlos.'} />
          )}
          {datos && datos.total > 0 && <Paginacion pagina={datos.pagina} tamano={datos.tamano} total={datos.total} onCambiar={p => cambiar('pagina', String(p))} />}
        </Tarjeta>
      </div>

      {zoom && <VisorZoom d={zoom} onCerrar={() => setZoom(null)} />}
      {editando && <ValidarModal d={editando} onCerrar={() => setEditando(null)} onValidada={actualizada => alEditar(actualizada)} />}
      {eliminando && <EliminarUno d={eliminando} onCerrar={() => setEliminando(null)} />}
      {eliminarVarios && datos && (
        <EliminarVarios total={datos.total} filtros={consultaParams} onCerrar={() => setEliminarVarios(false)} onHecho={() => recargar(true)}
          descripcion={hayFiltros ? 'Registros completos con salida que cumplen los filtros aplicados' : 'Todos los registros completos con salida del sistema'} />
      )}

    </div>
  );
};

export default Detecciones;
