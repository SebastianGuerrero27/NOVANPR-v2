import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Download, Edit3, Plus, Search, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useDiferido } from '../../aplicacion/hooks';
import type { RegistroLista } from '../../dominio/tipos';
import { fecha, fechaIsoLocal, NIVELES_ALERTA, numero } from '../../dominio/formato';
import { descargarBlob } from '../../infraestructura/descargas';
import { formatearPlaca } from '../../dominio/validacion';
import { Aviso, Confirmar, FilasEsqueleto, Pestanas, Placa, Segmentado, Tarjeta, Vacio } from '../componentes/ui';
import { FormularioLista, RUTA_API, TipoLista } from '../componentes/FormularioLista';
import { useNotificar } from '../componentes/Notificaciones';
import { CeldaEvidenciaLista } from '../componentes/EvidenciaLista';
import { ImportarPermisos } from '../componentes/ImportarPermisos';

type Vigencia = 'todas' | 'vigentes' | 'por_vencer' | 'vencidas';

/** El plazo de "por vencer" lo define la configuración del sistema (lo calcula la API). */
function vigenciaDe(r: RegistroLista): Exclude<Vigencia, 'todas'> {
  if (!r.vigente) return 'vencidas';
  return r.por_vencer ? 'por_vencer' : 'vigentes';
}

const InsigniaVigencia: React.FC<{ r: RegistroLista }> = ({ r }) => {
  const v = vigenciaDe(r);
  if (v === 'vencidas') return <span className="insignia neutro">Vencida · {fecha(r.fecha_vencimiento)}</span>;
  if (r.pendiente_inicio) return <span className="insignia info">Desde {fecha(r.fecha_inicio)}</span>;
  if (!r.fecha_vencimiento) return <span className="insignia autorizado">Permanente</span>;
  return <span className={`insignia ${v === 'por_vencer' ? 'no_reconocido' : 'autorizado'}`}>Hasta {fecha(r.fecha_vencimiento)}</span>;
};

function aCsv(tipo: TipoLista, filas: RegistroLista[]): Blob {
  const c = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = tipo === 'autorizados'
    ? ['ID', 'Nombres', 'Cédula', 'Institución', 'Cargo', 'Placa', 'Marca', 'Modelo', 'Tipo', 'Color', 'Departamento', 'Vigente desde', 'Vigente hasta', 'Horario', 'Observaciones', 'Ingresos', 'Registrado por', 'Fecha de registro']
    : ['Placa', 'Motivo', 'Nivel', 'Tipo', 'Marca', 'Modelo', 'Color', 'Vigente desde', 'Vigente hasta', 'Horario', 'Observaciones', 'Detecciones', 'Registrado por', 'Fecha de registro'];
  const lineas = filas.map(r => (tipo === 'autorizados'
    ? [r.id, r.propietario, r.cedula, r.institucion, r.cargo, r.placa, r.marca, r.modelo, r.tipo_vehiculo, r.color, r.departamento,
      r.fecha_inicio?.slice(0, 10), r.fecha_vencimiento?.slice(0, 10), r.horario_texto, r.observaciones, r.ingresos, r.registrado_por_email, fecha(r.fecha_registro)]
    : [r.placa, r.motivo, r.nivel_alerta, r.tipo_vehiculo, r.marca, r.modelo, r.color, r.fecha_inicio?.slice(0, 10), r.fecha_vencimiento?.slice(0, 10), r.horario_texto, r.observaciones, r.ingresos, r.registrado_por_email, fecha(r.fecha_registro)]
  ).map(c).join(','));
  return new Blob(['﻿' + [cab.map(c).join(','), ...lineas].join('\n')], { type: 'text/csv;charset=utf-8' });
}

/**
 * Listas de control. `incrustada` la muestra dentro de otra vista (gestión de permisos) con el
 * `tipo` fijo, sin las pestañas de navegación entre listas.
 */
const Listas: React.FC<{ tipo?: TipoLista; incrustada?: boolean; soloMios?: boolean }> = ({ tipo: tipoFijo, incrustada, soloMios = false }) => {
  const { tipo: tipoRuta } = useParams();
  const tipo: TipoLista = tipoFijo ?? (tipoRuta === 'alertas' ? 'alertas' : 'autorizados');
  const { puede } = useAuth();
  // El historial de ingresos de una placa es parte de la operación
  const verIngresos = puede('operacion:monitorear');
  const navigate = useNavigate();
  const notificar = useNotificar();
  const [params] = useSearchParams();
  // Cada lista tiene su propio permiso de edición (matriz RBAC): el gestor de permisos edita el
  // padrón pero no la lista de alertas
  const puedeEditar = puede(tipo === 'autorizados' ? 'padron:gestionar' : 'alertas:gestionar');
  const [busqueda, setBusqueda] = useState(() => params.get('q') ?? '');
  const [vigencia, setVigencia] = useState<Vigencia>(() => {
    const v = params.get('vigencia');
    return v === 'vigentes' || v === 'por_vencer' || v === 'vencidas' ? v : 'todas';
  });
  const [editando, setEditando] = useState<RegistroLista | 'nuevo' | null>(null);
  const [retirando, setRetirando] = useState<RegistroLista | null>(null);
  const [importando, setImportando] = useState(false);
  const { datos, cargando, error, recargar } = useConsulta<RegistroLista[]>(() => api.get(soloMios ? '/vehiculos-autorizados/mis-permisos' : RUTA_API[tipo]).then(r => r.data), [tipo, soloMios]);
  const diferido = useDiferido(() => recargar(true), 800);
  useReconexion(() => recargar(true));
  useEvento<{ lista: string }>('listas:actualizadas', e => { if (e.lista === (tipo === 'alertas' ? 'lista_negra' : 'autorizado')) diferido(); });

  const conteo = useMemo(() => {
    const c = { todas: 0, vigentes: 0, por_vencer: 0, vencidas: 0 };
    for (const r of datos ?? []) { c.todas++; c[vigenciaDe(r)]++; }
    return c;
  }, [datos]);

  const filas = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    const qPlaca = q.replace(/[^A-Z0-9]/g, '');
    return (datos ?? []).filter(r => (vigencia === 'todas' || vigenciaDe(r) === vigencia) && (!q
      || (qPlaca && r.placa?.includes(qPlaca))
      || [r.propietario, r.cedula, r.institucion, r.cargo, r.departamento, r.motivo, r.marca, r.modelo, r.observaciones].some(x => x?.toUpperCase().includes(q))));
  }, [datos, busqueda, vigencia]);

  return (
    <div className={incrustada ? undefined : 'pagina'}>
      <div className="pila">
        {!incrustada && <Pestanas<TipoLista> valor={tipo} onCambiar={t => navigate(`/listas/${t}`)}
          opciones={[
            { valor: 'autorizados', etiqueta: 'Lista blanca', icono: <ShieldCheck size={15} /> },
            { valor: 'alertas', etiqueta: 'Lista negra', icono: <ShieldAlert size={15} /> },
          ]} />}

        {!puedeEditar && <Aviso tipo="info">Consulta de solo lectura. {tipo === 'autorizados'
          ? <>Los permisos los otorga el gestor. Puede completar una placa pendiente después de verificar a la persona. Para un nuevo permiso, <Link to="/solicitudes?seccion=solicitudes">envíe una solicitud de acceso</Link>.</>
          : 'Las altas y cambios los realiza el administrador.'}</Aviso>}
        {/* La lista blanca muestra los permisos activos; el registro completo por usuario está en Solicitudes */}
        {!incrustada && tipo === 'autorizados' && puede('padron:supervisar') && <Aviso tipo="info">
          Aquí están los permisos activos de todos los usuarios. Para ver lo que otorgó cada gestor, incluidos los retirados,
          abra <Link to="/solicitudes">Gestión de Permisos › Permisos otorgados por todos los usuarios</Link>.
        </Aviso>}
        {error && <Aviso tipo="error">{error}</Aviso>}

        <Tarjeta
          titulo={soloMios ? 'Mis permisos otorgados' : tipo === 'autorizados' ? 'Lista blanca · permisos de acceso' : 'Lista negra · placas con alerta de seguridad'}
          subtitulo={soloMios ? 'Permisos con placa o por nombre otorgados por su usuario. Cada permiso conserva a su propietario.' : tipo === 'autorizados'
            ? 'Solo una coincidencia exacta de un permiso vigente, dentro de su horario, concede el ingreso automático.'
            : 'Se alerta incluso ante lecturas aproximadas (confusiones típicas del OCR como 0/O u 8/B).'}
          acciones={<>
            <button className="btn btn-secondary btn-sm" disabled={!filas.length} onClick={() => descargarBlob(aCsv(tipo, filas), `${tipo === 'autorizados' ? 'vehiculos_autorizados' : 'lista_alertas'}_${fechaIsoLocal()}.csv`)}>
              <Download size={14} /> Exportar
            </button>
            {/* Permisos desde la hoja de Excel de la garita (id, nombres, cedula, institucion, cargo, placa, marca, modelo, tipo, color) */}
            {puedeEditar && tipo === 'autorizados' && <button className="btn btn-secondary btn-sm" onClick={() => setImportando(true)}>
              <Upload size={14} /> Importar
            </button>}
            {puedeEditar && <button className={`btn btn-sm ${tipo === 'autorizados' ? 'btn-navy' : 'btn-primary'}`} onClick={() => setEditando('nuevo')}><Plus size={14} /> Agregar</button>}
          </>}
          sinPadding>
          <div className="filtros" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="campo crece" style={{ maxWidth: 380 }}>
              <div className="input-icono"><Search size={15} />
                <input className="input" value={busqueda} onChange={e => setBusqueda(e.target.value)} maxLength={100} placeholder={tipo === 'autorizados' ? 'Nombre, cédula, institución, placa…' : 'Placa, motivo, marca…'} aria-label="Buscar" />
              </div>
            </div>
            <Segmentado<Vigencia> valor={vigencia} onCambiar={setVigencia} opciones={[
              { valor: 'todas', etiqueta: `Todas (${conteo.todas})` },
              { valor: 'vigentes', etiqueta: `Vigentes (${conteo.vigentes})` },
              { valor: 'por_vencer', etiqueta: `Por vencer (${conteo.por_vencer})` },
              { valor: 'vencidas', etiqueta: `Vencidas (${conteo.vencidas})` },
            ]} />
          </div>
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead><tr>
                {tipo === 'autorizados'
                  ? <><th>ID</th><th>Nombres y apellidos</th><th>Cédula</th><th>Institución</th><th>Cargo</th><th>Placa</th><th>Vehículo</th><th>Placa recortada</th><th>Marca</th><th>Modelo</th><th>Tipo</th><th>Color</th></>
                  : <><th>Placa</th><th>Vehículo</th><th>Placa recortada</th><th>Motivo</th><th>Nivel</th></>}
                <th>Vigencia</th><th className="num ocultar-movil">{tipo === 'autorizados' ? 'Ingresos' : 'Detecciones'}</th>
                <th className="ocultar-movil">Registro</th>{puedeEditar && <th>Acciones</th>}
              </tr></thead>
              <tbody>
                {cargando && !datos ? <FilasEsqueleto columnas={(tipo === 'autorizados' ? 15 : 8) + (puedeEditar ? 1 : 0)} /> : filas.map(r => (
                  <tr key={r.id} className={r.vigente ? '' : 'inactivo'}>
                    {tipo === 'autorizados' ? (
                      <>
                        <td className="num texto-secundario">{r.id}</td>
                        <td><strong style={{ color: 'var(--text)', fontWeight: 600 }}>{r.propietario}</strong>
                          <span className="secundario truncar" style={{ maxWidth: 280 }} title={r.observaciones ?? ''}>{[r.departamento, r.motivo_ingreso, r.observaciones].filter(Boolean).join(' · ')}</span>
                          {r.horario && <span className="secundario" title="Horario de acceso"><Clock size={11} style={{ verticalAlign: -1 }} /> {r.horario_texto}</span>}</td>
                        <td className="nowrap">{r.cedula || '—'}</td><td>{r.institucion || '—'}</td><td>{r.cargo || '—'}</td>
                        <td>{r.placa ? <Placa valor={r.placa} /> : <span className="insignia info">Pendiente de placa</span>}</td>
                        <CeldaEvidenciaLista registro={r} tipo="vehiculo" /><CeldaEvidenciaLista registro={r} tipo="placa" />
                        <td>{r.marca || '—'}</td><td>{r.modelo || '—'}</td><td>{r.tipo_vehiculo || '—'}</td><td>{r.color || '—'}</td>
                      </>
                    ) : (
                      <>
                        <td><Placa valor={r.placa} sinPlaca /></td>
                        <CeldaEvidenciaLista registro={r} tipo="vehiculo" /><CeldaEvidenciaLista registro={r} tipo="placa" />
                        <td style={{ maxWidth: 320 }}><span style={{ color: 'var(--text)', fontWeight: 600 }}>{r.motivo}</span>
                          <span className="secundario truncar">{[r.tipo_vehiculo, [r.marca, r.modelo].filter(Boolean).join(' '), r.color, r.observaciones].filter(Boolean).join(' · ')}</span></td>
                        <td><span className={`insignia ${NIVELES_ALERTA[r.nivel_alerta ?? 'ALTA'].clase}`}>{NIVELES_ALERTA[r.nivel_alerta ?? 'ALTA'].etiqueta}</span></td>
                      </>
                    )}
                    <td><InsigniaVigencia r={r} /></td>
                    <td className="num ocultar-movil">{r.ingresos > 0 && verIngresos && r.placa ? <Link to={`/historial?placa=${r.placa}`} title="Ver ingresos en el historial completo">{numero(r.ingresos)}</Link> : numero(r.ingresos)}</td>
                    <td className="ocultar-movil"><span className="texto-secundario">{fecha(r.fecha_registro)}</span><span className="secundario">{r.registrado_por_email ?? '—'}</span></td>
                    {puedeEditar && (
                      <td className="acciones-celda">
                        <button className="btn btn-ghost btn-sm btn-icono" onClick={() => setEditando(r)} title="Editar" aria-label="Editar"><Edit3 size={15} /></button>
                        <button className="btn btn-ghost btn-sm btn-icono" onClick={() => setRetirando(r)} title="Retirar de la lista" aria-label="Retirar"><Trash2 size={15} color="var(--alerta)" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos && filas.length === 0 && (
            <Vacio titulo={datos.length ? 'Sin coincidencias' : tipo === 'autorizados' ? 'La lista blanca está vacía' : 'La lista negra está vacía'}
              texto={datos.length ? 'Ajuste la búsqueda o el filtro de vigencia.' : puedeEditar ? 'Use “Agregar” para registrar el primero.' : undefined} />
          )}
        </Tarjeta>
      </div>
      {editando && (
        <FormularioLista tipo={tipo} registro={editando === 'nuevo' ? undefined : editando} onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar(true); notificar('exito', editando === 'nuevo' ? 'Registro agregado' : 'Cambios guardados'); }} />
      )}
      {importando && (
        <ImportarPermisos onCerrar={() => setImportando(false)} onImportado={r => {
          recargar(true);
          if (r.resumen.crear + r.resumen.reactivar) notificar('exito', 'Permisos importados', `${r.resumen.crear} creados y ${r.resumen.reactivar} reactivados desde ${r.archivo}.`);
        }} />
      )}
      {retirando && (
        // Un permiso de la lista blanca se retira sin motivo (se puede reactivar); la lista negra lo exige
        <Confirmar titulo="Retirar de la lista" pedirMotivo={tipo === 'alertas'} peligro textoBoton="Retirar"
          mensaje={<>Se retirará {tipo === 'autorizados' ? 'el permiso de ' : ''}<b>{retirando.placa ? formatearPlaca(retirando.placa) : retirando.propietario}</b> de la lista. El historial de ingresos se conserva.</>}
          onConfirmar={async motivo => {
            try { await api.delete(`${RUTA_API[tipo]}/${retirando.id}`, tipo === 'alertas' ? { data: { motivo } } : undefined); } catch (e) { throw new Error(mensajeError(e)); }
            recargar(true);
            notificar('exito', `${retirando.placa ? formatearPlaca(retirando.placa) : retirando.propietario} retirado de la lista`);
          }}
          onCerrar={() => setRetirando(null)} />
      )}
    </div>
  );
};

export default Listas;
