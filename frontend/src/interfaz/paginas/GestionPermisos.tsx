import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, FileCheck2, Plus, ShieldCheck, UserCheck } from 'lucide-react';
import api from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useDiferido } from '../../aplicacion/hooks';
import type { PanelAccesos as Panel } from '../../dominio/tipos';
import { numero, relativo } from '../../dominio/formato';
import { formatearPlaca } from '../../dominio/validacion';
import { Aviso, Kpi, Pestanas } from '../componentes/ui';
import { FormularioLista } from '../componentes/FormularioLista';

import { useNotificar } from '../componentes/Notificaciones';
import SolicitudesAcceso from './SolicitudesAcceso';
import Listas from './Listas';

type Pestana = 'solicitudes' | 'permisos';

/**
 * Vista única del gestor de permisos: todo lo necesario para conceder permisos de placa en una
 * sola pantalla, sin monitoreo en vivo ni registro de ingresos. Pestañas: solicitudes por
 * resolver y permisos propios (con placa o por nombre).
 *
 * La pestaña vive en la URL (?pestana=), igual que los enlaces de las notificaciones
 * (?id= de una solicitud, ?q= de la lista blanca filtrada por placa), que llegan aquí redirigidos.
 */
const GestionPermisos: React.FC = () => {
  const { user } = useAuth();
  const notificar = useNotificar();
  const [params, setParams] = useSearchParams();
  const [concediendo, setConcediendo] = useState<string | null>(null);
  const pestana: Pestana = params.get('pestana') === 'solicitudes' || params.has('id') ? 'solicitudes' : 'permisos';

  const { datos: p, cargando, error, recargar } = useConsulta<Panel>(() => api.get('/panel/accesos').then(r => r.data), []);
  const diferido = useDiferido(() => recargar(true), 3000);
  useReconexion(() => recargar(true));
  useEvento('solicitudes:actualizadas', diferido);
  useEvento('listas:actualizadas', diferido);
  useEvento('deteccion:actualizada', diferido);

  const cambiar = (destino: Pestana, extra: Record<string, string> = {}) => setParams({ pestana: destino, ...extra });

  return (
    <div className="pagina">
      <div className="fila" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 21, fontWeight: 800 }}>Gestión de permisos · {user?.nombre.split(' ')[0]}</h2>
          <p className="texto-secundario">Entregue permisos de acceso (lista blanca) y resuelva las solicitudes que envía la garita · {p ? `actualizado ${relativo(p.generado)}` : 'cargando…'}</p>
        </div>
        <button className="btn btn-navy" onClick={() => setConcediendo('')}><Plus size={16} /> Entregar permiso</button>
      </div>
      {error && <Aviso tipo="error" style={{ marginBottom: 16 }}>{error}</Aviso>}

      <div className="pila">
        <div className="grid-kpi">
          <Kpi etiqueta="Solicitudes por resolver" valor={numero(p?.solicitudes.pendientes)} icono={<FileCheck2 size={17} />} cargando={cargando}
            color="var(--pendiente)" fondo="var(--pendiente-bg)" onClick={() => cambiar('solicitudes')}
            pie={p?.solicitudes.ultimas[0] ? `Pedidos de la garita que esperan su respuesta · el más antiguo ${relativo(p.solicitudes.ultimas[0].fecha_solicitud)}` : 'Ningún pedido de la garita espera respuesta'} />
          <Kpi etiqueta="Mis permisos vigentes" valor={numero(p?.padron.vigentes)} icono={<ShieldCheck size={17} />} cargando={cargando}
            color="var(--autorizado)" fondo="var(--autorizado-bg)" onClick={() => cambiar('permisos')}
            pie={p ? `${numero(p.padron.con_horario)} con horario · ${numero(p.padron.por_iniciar)} por iniciar` : undefined} />
          <Kpi etiqueta={`Vencen en ${p?.padron.dias_aviso ?? 7} días`} valor={numero(p?.padron.por_vencer)} icono={<CalendarClock size={17} />} cargando={cargando}
            color="var(--no-registrado)" fondo="var(--no-registrado-bg)" onClick={() => cambiar('permisos', { vigencia: 'por_vencer' })}
            pie={p ? `${numero(p.padron.vencidos)} vencidos sin retirar` : undefined} />
          <Kpi etiqueta="Mis permisos otorgados" valor={numero(p?.padron.total)} icono={<UserCheck size={17} />} cargando={cargando}
            color="var(--navy-700)" onClick={() => cambiar('permisos')}
            pie={`${numero(p?.padron.sin_placa)} pendientes de placa · solo su usuario`} />
        </div>

        <Pestanas<Pestana> valor={pestana} onCambiar={v => cambiar(v)} opciones={[
          { valor: 'solicitudes', etiqueta: 'Solicitudes por resolver', icono: <FileCheck2 size={15} />, num: p?.solicitudes.pendientes },
          { valor: 'permisos', etiqueta: 'Mis permisos', icono: <ShieldCheck size={15} />, num: p?.padron.total },
        ]} />

        {pestana === 'solicitudes' && <SolicitudesAcceso incrustada onVerPadron={() => cambiar('permisos')} />}

        {/* La clave reinicia los filtros de la lista cuando cambian en la URL (vigencia, búsqueda) */}
        {pestana === 'permisos' && <Listas key={params.toString()} tipo="autorizados" incrustada soloMios />}

      </div>

      {concediendo !== null && (
        <FormularioLista tipo="autorizados" inicial={concediendo ? { placa: concediendo } : undefined} onCerrar={() => setConcediendo(null)}
          onGuardado={r => { setConcediendo(null); notificar('exito', `Permiso concedido a ${r.placa ? formatearPlaca(r.placa) : r.propietario}`); recargar(true); }} />
      )}
    </div>
  );
};

export default GestionPermisos;
