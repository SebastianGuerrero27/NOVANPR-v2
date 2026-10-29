import React, { useState } from 'react';
import { AlertTriangle, Loader2, Save, Send, ShieldCheck } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import type { Deteccion, Franja, SolicitudAcceso } from '../../dominio/tipos';
import { fechaHora, fechaIsoLocal } from '../../dominio/formato';
import {
  errorDe, erroresTexto, normalizarPlaca, placaPropuesta, sinErrores, validarFecha, validarPlaca, validarTexto, valorPrecargado,
} from '../../dominio/validacion';
import { REGLA_COMENTARIO_APROBACION, REGLA_OBSERVACIONES, REGLAS_LISTA_BLANCA, REGLAS_SOLICITUD, REGLAS_VEHICULO } from '../../dominio/reglas';
import { Aviso, Modal, Placa } from './ui';
import { CampoTexto } from './campos';
import { CamposFormularioPermiso } from './CamposFormularioPermiso';
import { horarioValido } from './EditorHorario';

export interface DatosIniciales {
  propietario?: string; cedula?: string; institucion?: string; cargo?: string; departamento?: string;
  observaciones?: string; fecha_inicio?: string; fecha_fin?: string; horario?: Franja[] | null;
  placa?: string | null;
  marca?: string | null;
  modelo?: string | null;
  color?: string | null;
  tipo_vehiculo?: string | null;
  deteccion_id?: number;
}

/**
 * Solicitud de autorización de una placa (guardia): el gestor de permisos la
 * recibe como notificación y decide. Se abre desde el aviso de vehículo no autorizado, el
 * detalle de un ingreso o la pantalla de solicitudes. Con `solicitud` edita una solicitud propia
 * pendiente (PUT, mismo cuerpo que el alta): la API rechaza la edición si ya fue resuelta.
 */
export const FormularioSolicitud: React.FC<{
  inicial?: DatosIniciales; solicitud?: SolicitudAcceso; deteccion?: Deteccion; onCerrar: () => void; onEnviada: (s: SolicitudAcceso) => void;
}> = ({ inicial, solicitud, deteccion, onCerrar, onEnviada }) => {
  const [f, setF] = useState(() => solicitud
    ? {
      placa: normalizarPlaca(solicitud.placa), propietario: solicitud.propietario, departamento: solicitud.departamento ?? '',
      cedula: solicitud.cedula ?? '', institucion: solicitud.institucion ?? '', cargo: solicitud.cargo ?? '', observaciones: solicitud.observaciones ?? '',
      categoria: solicitud.categoria, motivo: solicitud.motivo,
      // Los campos de opciones no muestran error: un valor anterior a las reglas se descarta y se vuelve a elegir
      tipo_vehiculo: valorPrecargado(solicitud.vehiculo.tipo, REGLAS_VEHICULO.tipo_vehiculo),
      marca: valorPrecargado(solicitud.vehiculo.marca, REGLAS_VEHICULO.marca),
      modelo: solicitud.vehiculo.modelo ?? '',
      color: valorPrecargado(solicitud.vehiculo.color, REGLAS_VEHICULO.color),
      fecha_inicio: solicitud.fecha_inicio?.slice(0, 10) ?? '', fecha_fin: solicitud.fecha_fin?.slice(0, 10) ?? '',
    }
    : {
      placa: placaPropuesta(inicial?.placa), propietario: inicial?.propietario ?? '', departamento: inicial?.departamento ?? '', categoria: 'VISITANTE', motivo: '',
      cedula: inicial?.cedula ?? '', institucion: inicial?.institucion ?? '', cargo: inicial?.cargo ?? '', observaciones: inicial?.observaciones ?? '',
      // Atributos que informó la cámara: se descartan los que no cumplen la regla del campo
      tipo_vehiculo: valorPrecargado(inicial?.tipo_vehiculo, REGLAS_VEHICULO.tipo_vehiculo),
      marca: valorPrecargado(inicial?.marca, REGLAS_VEHICULO.marca),
      modelo: valorPrecargado(inicial?.modelo, REGLAS_VEHICULO.modelo),
      color: valorPrecargado(inicial?.color, REGLAS_VEHICULO.color),
      fecha_inicio: inicial?.fecha_inicio ?? '', fecha_fin: inicial?.fecha_fin ?? fechaIsoLocal(),
    });
  const [horario, setHorario] = useState<Franja[] | null>(solicitud?.horario ?? inicial?.horario ?? null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poner = (k: keyof typeof f) => (v: string) => setF(x => ({ ...x, [k]: v }));
  const fechasOk = !f.fecha_fin || (f.fecha_inicio || fechaIsoLocal()) <= f.fecha_fin;
  const valido = (!f.cedula.trim() || /^\d{10}$/.test(f.cedula.trim())) && horarioValido(horario) && fechasOk && sinErrores({
    placa: errorDe(validarPlaca(f.placa)),
    ...erroresTexto(f, { ...REGLAS_SOLICITUD, ...REGLAS_LISTA_BLANCA, ...REGLAS_VEHICULO, observaciones: REGLA_OBSERVACIONES }),
    fecha_inicio: errorDe(validarFecha(f.fecha_inicio, { etiqueta: 'Fecha de inicio' })),
    fecha_fin: errorDe(validarFecha(f.fecha_fin, { etiqueta: 'Fecha de fin' })),
  });
  // Con la placa ya escrita (edición o lectura de la cámara) el foco va al responsable

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    const cuerpo = {
      ...f, horario, fecha_inicio: f.fecha_inicio || null, fecha_fin: f.fecha_fin || null,
      deteccion_id: solicitud ? solicitud.deteccion_id ?? undefined : inicial?.deteccion_id,
    };
    try {
      const r = solicitud ? await api.put(`/solicitudes-acceso/${solicitud.id}`, cuerpo) : await api.post('/solicitudes-acceso', cuerpo);
      onEnviada(r.data.solicitud);
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={solicitud ? <>Editar solicitud #{solicitud.id}</> : 'Solicitar autorización de ingreso'}
      subtitulo={solicitud
        ? 'Puede corregirla mientras esté pendiente. El gestor de permisos verá los datos actualizados.'
        : 'El gestor de permisos recibirá la solicitud de inmediato y decidirá si concede el permiso.'}
      onCerrar={onCerrar} bloquear={enviando} tamano="ancho"
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className="btn btn-navy" onClick={enviar} disabled={!valido || enviando}>
          {enviando ? <Loader2 size={14} className="girar" /> : solicitud ? <Save size={14} /> : <Send size={14} />} {solicitud ? 'Guardar cambios' : 'Enviar solicitud'}
        </button>
      </>}>
      <div className="form-grid">
        <CamposFormularioPermiso prefijo="s" valor={f} onCambiar={c => setF(x => ({ ...x, ...c }))} horario={horario} onHorario={setHorario} deteccion={deteccion} placaObligatoria mostrarMotivo={false}>
        <CampoTexto id="s-motivo" className="completo" etiqueta="Motivo del ingreso*" valor={f.motivo} onCambiar={poner('motivo')}
          regla={REGLAS_SOLICITUD.motivo} multilinea ayuda="Entre 5 y 300 caracteres."
          placeholder="Ej.: entrega de equipos de radio, reunión con el coordinador zonal" />
        </CamposFormularioPermiso>
        {error && <div className="completo"><Aviso tipo="error">{error}</Aviso></div>}
      </div>
    </Modal>
  );
};

/**
 * Aprobación por el gestor de permisos: puede ajustar categoría, vigencia y horario antes de
 * conceder el permiso y, si la solicitud nació de un ingreso y tiene detecciones:validar (Admin),
 * validarlo en el mismo paso. El gestor de permisos no valida ingresos: lo hace la garita al
 * recibir la resolución.
 */
export const AprobarSolicitud: React.FC<{ s: SolicitudAcceso; onCerrar: () => void; onAprobada: (mensaje: string) => void }> = ({ s, onCerrar, onAprobada }) => {
  const [a, setA] = useState({ categoria: s.categoria, propietario: s.propietario, cedula: s.cedula ?? '', institucion: s.institucion ?? '', cargo: s.cargo ?? '', departamento: s.departamento ?? '',
    tipo_vehiculo: s.vehiculo.tipo ?? '', marca: s.vehiculo.marca ?? '', modelo: s.vehiculo.modelo ?? '', color: s.vehiculo.color ?? '', observaciones: s.observaciones ?? '',
    fecha_inicio: s.fecha_inicio?.slice(0, 10) ?? '', fecha_fin: s.fecha_fin?.slice(0, 10) ?? '', comentario: '',
    // El motivo de la solicitud queda como motivo de ingreso del permiso (editable al aprobar)
    motivo_ingreso: s.motivo ?? '' });
  const [horario, setHorario] = useState<Franja[] | null>(s.horario);
  const { puede } = useAuth();
  const puedeValidar = puede('detecciones:validar');
  const vehiculoCompleto = Object.entries(REGLAS_VEHICULO).every(([k, regla]) => validarTexto(a[k as keyof typeof a], { ...regla, requerido: true }).ok);
  const [validarIngreso, setValidarIngreso] = useState(Boolean(s.deteccion_id) && puedeValidar && vehiculoCompleto);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fechasOk = !a.fecha_fin || (a.fecha_inicio || fechaIsoLocal()) <= a.fecha_fin;
  const valido = (!validarIngreso || vehiculoCompleto) && (!a.cedula.trim() || /^\d{10}$/.test(a.cedula.trim())) && horarioValido(horario) && fechasOk && sinErrores({
    ...erroresTexto(a, { ...REGLAS_LISTA_BLANCA, ...REGLAS_VEHICULO, observaciones: REGLA_OBSERVACIONES }),
    comentario: errorDe(validarTexto(a.comentario, REGLA_COMENTARIO_APROBACION)),
    fecha_inicio: errorDe(validarFecha(a.fecha_inicio, { etiqueta: 'Fecha de inicio' })),
    fecha_fin: errorDe(validarFecha(a.fecha_fin, { etiqueta: 'Fecha de fin' })),
  });

  const aprobar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post(`/solicitudes-acceso/${s.id}/aprobar`, {
        comentario: a.comentario.trim() || undefined,
        ajustes: { ...a, fecha_inicio: a.fecha_inicio || null, fecha_fin: a.fecha_fin || null, horario },
        // Lo que el gestor revisó: si el solicitante la editó mientras tanto, la API no la aprueba (409)
        version: s.version,
      });
      let mensaje: string = r.data.message;
      if (validarIngreso && puedeValidar && s.deteccion_id) {
        try {
          const v = await api.post(`/detecciones/validar/${s.deteccion_id}`, {
            placa_validada: s.placa, observacion: `Solicitud de acceso #${s.id} aprobada`,
            tipo_vehiculo: a.tipo_vehiculo, marca: a.marca, modelo: a.modelo, color: a.color,
            persona_ingreso: a.propietario, motivo_ingreso: s.motivo,
          });
          mensaje += v.data.deteccion?.estado_validacion === 'autorizado'
            ? ' El ingreso quedó autorizado.'
            : ' El ingreso no quedó autorizado: revise el horario o la vigencia del permiso.';
        } catch (e) {
          mensaje += ` No se pudo validar el ingreso: ${mensajeError(e)}`;
        }
      }
      onAprobada(mensaje);
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={<>Aprobar solicitud #{s.id} · <Placa valor={s.placa} /></>} subtitulo={`${s.solicitante.nombre} · ${fechaHora(s.fecha_solicitud)}`}
      onCerrar={onCerrar} bloquear={enviando} tamano="ancho"
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className="btn btn-exito" onClick={aprobar} disabled={!valido || enviando}>{enviando ? <Loader2 size={14} className="girar" /> : <ShieldCheck size={14} />} Aprobar y agregar a lista blanca</button>
      </>}>
      <div className="pila">
        {s.en_lista_alertas && (
          <Aviso tipo="error"><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Esta placa está en la <b>lista negra</b>: aunque se apruebe, cada paso seguirá generando una alerta de seguridad.</Aviso>
        )}
        {s.permiso_actual_id && <Aviso tipo="info">La placa ya tiene un permiso activo: la aprobación lo actualizará con la vigencia y el horario indicados.</Aviso>}
        <dl className="definiciones">
          <dt>Responsable</dt><dd>{s.propietario}{s.departamento ? ` · ${s.departamento}` : ''}</dd>
          <dt>Motivo</dt><dd>{s.motivo}</dd>
          <dt>Vehículo</dt><dd>{[s.vehiculo.tipo, s.vehiculo.marca, s.vehiculo.modelo, s.vehiculo.color].filter(Boolean).join(' · ') || '—'}</dd>
        </dl>
        <div className="form-grid">
          <CamposFormularioPermiso prefijo="a" valor={{ ...a, placa: s.placa }} onCambiar={c => { const { placa: _placa, ...ajustes } = c; setA(x => ({ ...x, ...ajustes })); }} horario={horario} onHorario={setHorario} placaObligatoria placaFija vehiculoObligatorio={validarIngreso} />
          <CampoTexto id="a-com" className="completo" etiqueta="Comentario para el solicitante" valor={a.comentario}
            onCambiar={v => setA({ ...a, comentario: v })} regla={REGLA_COMENTARIO_APROBACION} placeholder="Opcional" />
          {s.deteccion_id && puedeValidar && (
            <label className="completo fila" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={validarIngreso} onChange={e => setValidarIngreso(e.target.checked)} />
              <span>Autorizar también el ingreso #{s.deteccion_id} que originó la solicitud</span>
            </label>
          )}
          {s.deteccion_id && puedeValidar && !vehiculoCompleto && <div className="completo"><Aviso tipo="info">Puede aprobar el permiso sin autorizar el ingreso. Para autorizarlo también, complete el tipo de vehículo, marca, modelo y color.</Aviso></div>}
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
    </Modal>
  );
};
