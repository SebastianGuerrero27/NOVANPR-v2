import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, CalendarClock, Clock, Database, KeyRound, Mail, Server, ShieldAlert, ShieldCheck, UserCheck,
} from 'lucide-react';
import api from '../../infraestructura/api';
import { useConsulta, usePaginaVisible } from '../../aplicacion/hooks';
import type { PanelAdministracion, ResumenPanel } from '../../dominio/tipos';
import { diaCorto, numero, SERIES_ESTADO } from '../../dominio/formato';
import { Cargando, Kpi, Tarjeta, Vacio } from '../componentes/ui';
import { BarrasApiladas, Leyenda } from '../componentes/Graficos';
import UsoCpu from '../componentes/UsoCpu';

/**
 * Estado del sistema (Administrador): servicios, recursos, cuentas, listas de control y
 * la tendencia de 7 días por estado.
 */

const Tendencia: React.FC<{ r: ResumenPanel }> = ({ r }) => (
  <Tarjeta titulo="Últimos 7 días" subtitulo="Ingresos diarios por estado" acciones={<Leyenda series={SERIES_ESTADO} />}>
    {r.tendencia.every(d => d.total === 0)
      ? <Vacio titulo="Sin ingresos en los últimos 7 días" icono={<Activity size={22} />} />
      : <BarrasApiladas datos={r.tendencia} series={SERIES_ESTADO} etiquetaX={d => diaCorto(d.fecha)} alto={200} resaltar={6} />}
  </Tarjeta>
);

const Listas: React.FC<{ r: ResumenPanel }> = ({ r }) => {
  const l = r.listas;
  return (
    <Tarjeta titulo="Listas de control" sinPadding>
      <div className="tabla-contenedor"><table className="tabla"><tbody>
        <tr><td><Link to="/listas/autorizados" style={{ textDecoration: 'none' }}><ShieldCheck size={14} color="var(--autorizado)" style={{ verticalAlign: -2 }} /> Autorizados vigentes</Link></td><td className="num"><b>{numero(l.autorizados_vigentes)}</b></td></tr>
        <tr><td><CalendarClock size={14} color="var(--no-registrado)" style={{ verticalAlign: -2 }} /> Vencen en {l.dias_aviso} días</td><td className="num"><b style={{ color: l.autorizados_por_vencer ? 'var(--no-registrado)' : undefined }}>{numero(l.autorizados_por_vencer)}</b></td></tr>
        <tr><td><Clock size={14} color="var(--text-4)" style={{ verticalAlign: -2 }} /> Autorizaciones vencidas</td><td className="num"><b>{numero(l.autorizados_vencidos)}</b></td></tr>
        <tr><td><Link to="/listas/alertas" style={{ textDecoration: 'none' }}><ShieldAlert size={14} color="var(--alerta)" style={{ verticalAlign: -2 }} /> Placas en lista negra</Link></td><td className="num"><b>{numero(l.alertas_vigentes)}</b></td></tr>
      </tbody></table></div>
    </Tarjeta>
  );
};

const Administracion: React.FC = () => {
  const { datos: a, cargando, recargar } = useConsulta<PanelAdministracion>(() => api.get('/panel/administracion').then(r => r.data), []);
  const visible = usePaginaVisible();
  useEffect(() => { if (visible) recargar(true); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  if (cargando && !a) return <Tarjeta titulo="Administración"><Cargando /></Tarjeta>;
  if (!a) return null;
  const s = a.servicios;
  return (
    <>
      <div className="grid-kpi">
        <Kpi etiqueta="Usuarios activos" valor={numero(a.usuarios.activos)} icono={<UserCheck size={17} />} color="var(--autorizado)" fondo="var(--autorizado-bg)"
          pie={`${a.usuarios.por_rol.Admin ?? 0} admin · ${a.usuarios.por_rol.GestorPermisos ?? 0} gestores de permisos · ${a.usuarios.por_rol.Guardia ?? 0} guardias`} />
        <Kpi etiqueta="Cuentas por verificar" valor={numero(a.usuarios.pendientes)} icono={<Mail size={17} />} color="var(--pendiente)" fondo="var(--pendiente-bg)" pie="Registro sin confirmar el correo" />
        <Kpi etiqueta="Cuentas bloqueadas" valor={numero(a.usuarios.bloqueados)} icono={<KeyRound size={17} />} color="var(--alerta)" fondo="var(--alerta-bg)" pie="Administrativo o por intentos" />
      </div>
      <Tarjeta titulo="Servicios">
        <div className="pila" style={{ gap: 12, fontSize: 13 }}>
          <div className="fila" style={{ justifyContent: 'space-between' }}><span className="fila" style={{ gap: 8 }}><Database size={15} /> Base de datos</span><span className="fila" style={{ gap: 6 }}><span className="punto verde" /> En línea</span></div>
          <div className="fila" style={{ justifyContent: 'space-between' }}><span className="fila" style={{ gap: 8 }}><Server size={15} /> Motor ANPR</span>
            <span className="fila" style={{ gap: 6 }}><span className={`punto ${s.anpr.en_linea ? 'verde' : 'rojo'}`} />{s.anpr.en_linea ? `En línea · ${numero(s.anpr.fps_captura ?? 0)} fps` : s.anpr.error ?? 'Fuera de línea'}</span></div>
          <div className="fila" style={{ justifyContent: 'space-between' }}><span className="fila" style={{ gap: 8 }}><Mail size={15} /> Correo (SMTP)</span>
            <span className="fila" style={{ gap: 6 }}><span className={`punto ${s.correo.configurado ? 'verde' : 'ambar'}`} />{s.correo.configurado ? 'Configurado' : 'Sin configurar'}</span></div>
          {s.anpr.en_linea && <p className="texto-secundario" style={{ fontSize: 12 }}>Detector {s.anpr.detector} · OCR {s.anpr.ocr}{s.anpr.verificador ? ` · verificador ${s.anpr.verificador}` : ''}</p>}
        </div>
      </Tarjeta>
    </>
  );
};

const EstadoSistema: React.FC = () => {
  const { datos: r } = useConsulta<ResumenPanel>(() => api.get('/panel/resumen').then(x => x.data), []);
  return (
    <div className="pagina">
      <div className="encabezado-pagina">
        <div>
          <h2>Estado del sistema</h2>
          <p>Servicios, uso de recursos, cuentas y listas de control</p>
        </div>
      </div>
      <div className="pila">
        <Administracion />
        <UsoCpu />
        {r ? (
          <div className="grid-principal">
            <Tendencia r={r} />
            <Listas r={r} />
          </div>
        ) : <Tarjeta titulo="Listas de control"><Cargando /></Tarjeta>}
      </div>
    </div>
  );
};

export default EstadoSistema;
