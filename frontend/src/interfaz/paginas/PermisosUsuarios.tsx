import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileStack, Plus, PowerOff, Search, ShieldCheck, Upload, UserCheck, Users } from 'lucide-react';
import api from '../../infraestructura/api';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useDiferido } from '../../aplicacion/hooks';
import type { RegistroLista } from '../../dominio/tipos';
import { fecha, fechaIsoLocal, numero, relativo } from '../../dominio/formato';
import { descargarBlob } from '../../infraestructura/descargas';
import { Aviso, FilasEsqueleto, Kpi, Placa, Segmentado, Tarjeta, Vacio } from '../componentes/ui';
import { FormularioLista } from '../componentes/FormularioLista';
import { ImportarPermisos } from '../componentes/ImportarPermisos';
import { useNotificar } from '../componentes/Notificaciones';
import { RegistradoPor } from '../componentes/RegistradoPor';
import { AccionesPermiso, estadoPermiso, useAccionesPermiso } from '../componentes/AccionesPermiso';

/** Respuesta de GET /vehiculos-autorizados/registro. */
interface RegistroPermisos {
  items: RegistroLista[];
  usuarios: {
    id: number; nombre: string; email: string; rol: string; estado: string;
    total: number; activos: number; vigentes: number; por_vencer: number; vencidos: number; retirados: number; sin_placa: number;
    ultimo_registro: string | null;
  }[];
}

type Estado = 'activos' | 'retirados' | 'todos';

/** Código del rol en la tabla Roles (lo entrega la API) → nombre visible. */
const NOMBRE_ROL: Record<string, string> = { ADMIN: 'Administrador', GUARDIA: 'Guardia', GESTOR_PERMISOS: 'Gestor de permisos' };

function aCsv(filas: RegistroLista[]): Blob {
  const c = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = ['ID', 'Nombres', 'Cédula', 'Institución', 'Cargo', 'Placa', 'Marca', 'Modelo', 'Tipo', 'Color', 'Departamento', 'Vigente desde',
    'Vigente hasta', 'Estado', 'Registrado por', 'Correo', 'Fecha de registro', 'Ingresos'];
  const lineas = filas.map(r => [r.id, r.propietario, r.cedula, r.institucion, r.cargo, r.placa, r.marca, r.modelo, r.tipo_vehiculo, r.color, r.departamento,
    r.fecha_inicio?.slice(0, 10), r.fecha_vencimiento?.slice(0, 10), estadoPermiso(r).texto, r.registrado_por_nombre, r.registrado_por_email,
    fecha(r.fecha_registro), r.ingresos].map(c).join(','));
  return new Blob(['﻿' + [cab.map(c).join(','), ...lineas].join('\n')], { type: 'text/csv;charset=utf-8' });
}

/**
 * Permisos por usuario (administrador, padron:supervisar): todos los permisos de la lista blanca
 * con quién los otorgó, incluidos los desactivados. Resume lo que registró cada gestor, filtra por
 * usuario, estado y texto, y permite crear, editar, desactivar, activar, renovar e importar permisos
 * (acciones compartidas con el gestor: componentes/AccionesPermiso.tsx).
 */
const PermisosUsuarios: React.FC<{ incrustada?: boolean }> = ({ incrustada }) => {
  const notificar = useNotificar();
  const [params, setParams] = useSearchParams();
  const usuario = params.get('usuario') ?? '';
  const estado: Estado = params.get('estado') === 'activos' || params.get('estado') === 'retirados' ? params.get('estado') as Estado : 'todos';
  const [busqueda, setBusqueda] = useState('');
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);

  const { datos, cargando, error, recargar } = useConsulta<RegistroPermisos>(
    () => api.get('/vehiculos-autorizados/registro', { params: { usuario: usuario || undefined, estado } }).then(r => r.data), [usuario, estado]);
  const diferido = useDiferido(() => recargar(true), 800);
  useEvento<{ lista: string }>('listas:actualizadas', e => { if (e.lista === 'autorizado') diferido(); });
  useReconexion(() => recargar(true));
  const acciones = useAccionesPermiso(() => recargar(true));

  const cambiar = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const filas = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    const qPlaca = q.replace(/[^A-Z0-9]/g, '');
    return (datos?.items ?? []).filter(r => !q || (qPlaca && r.placa?.includes(qPlaca))
      || [r.propietario, r.cedula, r.institucion, r.cargo, r.marca, r.modelo, r.registrado_por_nombre, r.registrado_por_email].some(x => x?.toUpperCase().includes(q)));
  }, [datos, busqueda]);
  const seleccionado = datos?.usuarios.find(u => String(u.id) === usuario);
  const totales = useMemo(() => (datos?.usuarios ?? []).reduce((t, u) => ({
    activos: t.activos + u.activos, vencidos: t.vencidos + u.vencidos, retirados: t.retirados + u.retirados, por_vencer: t.por_vencer + u.por_vencer,
  }), { activos: 0, vencidos: 0, retirados: 0, por_vencer: 0 }), [datos]);

  return (
    <div className={incrustada ? undefined : 'pagina'}>
      <div className="encabezado-pagina">
        <div>
          {/* Dentro de Gestión de Permisos la pestaña ya da el título */}
          {!incrustada && <h2>Permisos por usuario</h2>}
          <p>Permisos de la lista blanca otorgados por cada gestor (vigentes, vencidos y desactivados) · cada cambio queda en la auditoría</p>
        </div>
        <div className="fila">
          <button className="btn btn-secondary" onClick={() => setImportando(true)}><Upload size={15} /> Importar</button>
          <button className="btn btn-navy" onClick={() => setCreando(true)}><Plus size={15} /> Nuevo permiso</button>
        </div>
      </div>
      {error && <Aviso tipo="error" style={{ marginBottom: 16 }}>{error}</Aviso>}

      <div className="pila">
        <div className="grid-kpi">
          <Kpi etiqueta="Permisos activos" valor={numero(datos ? totales.activos : null)} icono={<ShieldCheck size={17} />} color="var(--autorizado)" fondo="var(--autorizado-bg)"
            cargando={!datos} onClick={() => cambiar('estado', 'activos')} pie={datos ? `${numero(totales.por_vencer)} por vencer · ${numero(totales.vencidos)} vencidos` : undefined} />
          <Kpi etiqueta="Desactivados" valor={numero(datos ? totales.retirados : null)} icono={<PowerOff size={17} />} cargando={!datos}
            onClick={() => cambiar('estado', 'retirados')} pie="Se pueden activar de nuevo" />
          <Kpi etiqueta="Usuarios que otorgan" valor={numero(datos?.usuarios.length)} icono={<Users size={17} />} cargando={!datos}
            pie="Gestores de permisos y quien registró alguno" />
        </div>

        <Tarjeta titulo="Permisos otorgados por cada usuario" subtitulo="Seleccione un usuario para ver solo sus permisos" sinPadding>
          <div className="tabla-contenedor">
            <table className="tabla compacta">
              <thead><tr><th>Usuario</th><th>Rol</th><th className="num">Total</th><th className="num">Vigentes</th><th className="num">Por vencer</th>
                <th className="num">Vencidos</th><th className="num">Desactivados</th><th className="num">Sin placa</th><th>Último registro</th><th /></tr></thead>
              <tbody>
                {!datos ? <FilasEsqueleto columnas={10} filas={3} /> : datos.usuarios.map(u => {
                  const activo = String(u.id) === usuario;
                  return (
                    <tr key={u.id} className={`clic${activo ? ' fila-elegida' : ''}`} onClick={() => cambiar('usuario', activo ? '' : String(u.id))}>
                      <td><strong style={{ color: 'var(--text)' }}>{u.nombre}</strong><span className="secundario">{u.email}{u.estado !== 'activo' ? ` · ${u.estado}` : ''}</span></td>
                      <td>{NOMBRE_ROL[u.rol] ?? u.rol}</td>
                      <td className="num"><strong>{numero(u.total)}</strong></td>
                      <td className="num">{numero(u.vigentes)}</td><td className="num">{numero(u.por_vencer)}</td><td className="num">{numero(u.vencidos)}</td>
                      <td className="num">{numero(u.retirados)}</td><td className="num">{numero(u.sin_placa)}</td>
                      <td className="nowrap texto-secundario">{u.ultimo_registro ? relativo(u.ultimo_registro) : 'Sin permisos'}</td>
                      <td><button type="button" className="btn btn-sm btn-secondary btn-opcion" aria-pressed={activo}
                        onClick={e => { e.stopPropagation(); cambiar('usuario', activo ? '' : String(u.id)); }}><UserCheck size={13} /> {activo ? 'Viendo' : 'Ver'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {datos && datos.usuarios.length === 0 && <Vacio titulo="Aún no hay gestores ni permisos" texto="Cree cuentas con el rol Gestor de permisos en Usuarios." icono={<Users size={22} />} />}
        </Tarjeta>

        <Tarjeta titulo={seleccionado ? `Permisos de ${seleccionado.nombre}` : 'Todos los permisos'}
          subtitulo={`${numero(filas.length)} ${filas.length === 1 ? 'permiso' : 'permisos'}${busqueda ? ' que coinciden con la búsqueda' : ''}`}
          acciones={<button className="btn btn-secondary btn-sm" disabled={!filas.length}
            onClick={() => descargarBlob(aCsv(filas), `permisos_por_usuario_${fechaIsoLocal()}.csv`)}><Download size={14} /> Exportar</button>}
          sinPadding>
          <div className="filtros" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="campo">
              <label htmlFor="pu-usuario">Usuario</label>
              <select id="pu-usuario" className="select" value={usuario} onChange={e => cambiar('usuario', e.target.value)}>
                <option value="">Todos los usuarios</option>
                {datos?.usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre} ({numero(u.total)})</option>)}
              </select>
            </div>
            <div className="campo crece" style={{ maxWidth: 380 }}>
              <label htmlFor="pu-buscar">Buscar</label>
              <div className="input-icono"><Search size={15} />
                <input id="pu-buscar" className="input" value={busqueda} onChange={e => setBusqueda(e.target.value)} maxLength={100} placeholder="Nombre, cédula, placa, institución…" />
              </div>
            </div>
            <Segmentado<Estado> valor={estado} onCambiar={v => cambiar('estado', v === 'todos' ? '' : v)} opciones={[
              { valor: 'todos', etiqueta: 'Todos' }, { valor: 'activos', etiqueta: 'Activos' }, { valor: 'retirados', etiqueta: 'Desactivados' },
            ]} />
          </div>
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead><tr>
                <th>ID</th><th>Nombres y apellidos</th><th>Cédula</th><th>Institución y cargo</th><th>Placa</th><th>Vehículo</th>
                <th>Estado</th><th>Registrado por</th><th className="num">Ingresos</th><th>Acciones</th>
              </tr></thead>
              <tbody>
                {cargando && !datos ? <FilasEsqueleto columnas={10} /> : filas.map(r => {
                  const e = estadoPermiso(r);
                  return (
                    <tr key={r.id} className={r.activo === false || !r.vigente ? 'inactivo' : ''}>
                      <td className="num texto-secundario">{r.id}</td>
                      <td><strong style={{ color: 'var(--text)', fontWeight: 600 }}>{r.propietario}</strong>{r.departamento && <span className="secundario">{r.departamento}</span>}</td>
                      <td className="nowrap">{r.cedula || '—'}</td>
                      <td>{r.institucion || '—'}{r.cargo && <span className="secundario">{r.cargo}</span>}</td>
                      <td>{r.placa ? <Placa valor={r.placa} /> : <span className="insignia info">Pendiente de placa</span>}</td>
                      <td>{[r.tipo_vehiculo, [r.marca, r.modelo].filter(Boolean).join(' '), r.color].filter(Boolean).join(' · ') || '—'}</td>
                      <td><span className={`insignia ${e.clase}`}>{e.texto}</span></td>
                      <td><RegistradoPor r={r} /></td>
                      <td className="num">{numero(r.ingresos)}</td>
                      <td className="acciones-celda"><AccionesPermiso r={r} onAccion={acciones.abrir} puedeEliminar /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {datos && filas.length === 0 && (
            <Vacio titulo={datos.items.length ? 'Sin coincidencias' : 'Sin permisos'} icono={<FileStack size={22} />}
              texto={datos.items.length ? 'Ajuste la búsqueda.' : seleccionado ? `${seleccionado.nombre} aún no ha otorgado permisos con este estado.` : 'Use «Nuevo permiso» o «Importar» para registrar el primero.'} />
          )}
        </Tarjeta>
      </div>

      {creando && (
        <FormularioLista tipo="autorizados" onCerrar={() => setCreando(false)}
          onGuardado={() => { setCreando(false); recargar(true); notificar('exito', 'Permiso registrado'); }} />
      )}
      {importando && <ImportarPermisos onCerrar={() => setImportando(false)} onImportado={() => recargar(true)} />}
      {acciones.dialogo}
    </div>
  );
};

export default PermisosUsuarios;
