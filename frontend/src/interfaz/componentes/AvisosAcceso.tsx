import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ShieldAlert, ShieldCheck, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento } from '../../aplicacion/tiempoReal';
import type { Deteccion } from '../../dominio/tipos';
import { hora, NIVELES_ALERTA } from '../../dominio/formato';
import { alCambiarSonido, detenerSonido, fijarSonido, sonarAutorizado, sonarDenegado, sonidoActivo } from '../../infraestructura/avisos';
import { PlacaFoto, ValidarModal } from './deteccion';
import { VisorZoom } from './ZoomDual';
import { useCentroNotificaciones } from '../../aplicacion/notificaciones';
import { RestringirVehiculoModal } from './RestringirVehiculoModal';

/**
 * Avisos de acceso en tiempo real, visibles en cualquier pantalla del sistema:
 *  - Vehículo NO REGISTRADO o en la LISTA DE ALERTAS → cuadro compacto con el motivo,
 *    acciones e indicaciones desplegables para el personal de la garita.
 *  - Vehículo AUTORIZADO → aviso verde con melodía breve (se cierra solo).
 * Solo se avisa de decisiones automáticas recientes; las validaciones manuales no disparan
 * avisos (las hizo el propio personal).
 *
 * Se muestra a quien tiene el permiso avisos:garita (personal del punto de control). "Enterado"
 * registra el reconocimiento (ACK) de las alarmas del paso en el centro de notificaciones, lo
 * que detiene su escalamiento y mide el tiempo de respuesta del personal. Los demás roles (p. ej.
 * el gestor de permisos) reciben únicamente los avisos que les correspondan en su bandeja.
 */

const VENTANA_S = 120;
const reciente = (d: Deteccion, segundos = VENTANA_S) => Date.now() - new Date(d.fecha_hora_ingreso).getTime() < segundos * 1000;

// La institución no cuenta con barrera o pluma mecánica: el control del acceso es verbal y
// visual por parte del personal en el punto de control.
const PROTOCOLO_NO_REGISTRADO = [
  ['Detener el vehículo en el punto de control', 'Con señal verbal y visual, indique al conductor que se detenga y no avance hacia las instalaciones hasta completar la verificación.'],
  ['Inspección visual', 'Desde un punto seguro, confirme que la placa física coincida con {placa} e identifique a los ocupantes.'],
  ['Solicitar documentos', 'Pida cédula de identidad, matrícula del vehículo y el motivo formal del ingreso.'],
  ['Autorizar el ingreso', 'Use “Autorizar” para revisar la placa y los datos del ingreso con la evidencia captada.'],
  ['Espera y registro', 'Mientras se verifica, pida al conductor estacionar a un lado sin obstruir el acceso. Si se aprueba, deje constancia en el sistema; si no, indíquele retirarse por la vía de salida.'],
];

const PROTOCOLO_RESTRINGIDO = [
  ['Detener el vehículo en el punto de control', 'Indique al conductor que se detenga: la placa {placa} tiene permiso, pero no es válido en este momento.'],
  ['Verificar identidad', 'Confirme que la placa física coincida con {placa} y pida la identificación del conductor.'],
  ['Consultar al gestor de permisos', 'El gestor de permisos ya fue notificado. Solo el administrador puede autorizar el ingreso por excepción.'],
  ['Registrar la decisión', 'Si se concede la excepción, quedará registrada con su motivo; si no, indique al conductor el horario o la vigencia de su permiso.'],
];

const PROTOCOLO_ALERTA = [
  ['Indicar alto sin exponerse', 'Pida al conductor detenerse en el punto de control manteniendo una distancia segura. Si no acata la indicación, no intente detenerlo físicamente.'],
  ['Notificación inmediata', 'Informe por radio al administrador y a la Central ECU 911 con la placa {placa} y el motivo de la alerta.'],
  ['No confrontar', 'No discuta con los ocupantes ni revele el motivo de la alerta; resguarde su seguridad y la del personal.'],
  ['Observación', 'Registre características del vehículo y de los ocupantes (color, marca, número de personas, dirección de salida).'],
  ['Verificar la lectura', 'Si la placa física no coincide con {placa}, corrija la lectura para que el sistema la reevalúe.'],
];

const TITULO_RESTRICCION: Record<string, string> = {
  fuera_horario: 'Acceso no autorizado: fuera del horario del permiso',
  no_iniciada: 'Acceso no autorizado: el permiso aún no está vigente',
  vencida: 'Acceso no autorizado: permiso vencido',
};

const AvisoNoAutorizado: React.FC<{
  d: Deteccion; pendientes: number; onCerrar: () => void; onValidar: () => void;
  onRestringir?: () => void;
}> = ({ d, pendientes, onCerrar, onValidar, onRestringir }) => {
  const [sonido, setSonido] = useState(sonidoActivo());
  const [zoom, setZoom] = useState(false);
  const esAlerta = d.estado_validacion === 'alerta';
  const restringido = !esAlerta ? d.restriccion_acceso : null;
  const protocolo = esAlerta ? PROTOCOLO_ALERTA : restringido ? PROTOCOLO_RESTRINGIDO : PROTOCOLO_NO_REGISTRADO;
  useEffect(() => alCambiarSonido(setSonido), []);
  return <div className="aviso-autorizado aviso-denegado" role="alert">
    <span className="icono"><ShieldAlert size={22} /></span>
    <div className="aviso-denegado-contenido">
      <strong>{esAlerta ? 'ALERTA DE SEGURIDAD' : 'ACCESO NO AUTORIZADO'}</strong>
      <PlacaFoto d={d} alto={34} onClick={() => setZoom(true)} />
      <span className="detalle motivo">{esAlerta ? d.alerta?.motivo || 'Placa en lista negra' : restringido ? TITULO_RESTRICCION[restringido] : 'Vehículo no registrado en la lista blanca'}</span>
      {esAlerta && d.alerta && <span className="detalle">Nivel: {NIVELES_ALERTA[d.alerta.nivel]?.etiqueta ?? d.alerta.nivel}</span>}
      <span className="detalle">{d.camara?.nombre ?? 'Acceso'} ? {hora(d.fecha_hora_ingreso)}</span>
      <details className="aviso-denegado-protocolo"><summary>Ver indicaciones</summary><ol>{protocolo.map(([titulo, texto]) => <li key={titulo}><b>{titulo}</b><p>{texto.replace('{placa}', d.placa ?? 'la placa captada')}</p></li>)}</ol></details>
      {pendientes > 0 && <span className="detalle">{pendientes} avisos en espera</span>}
      <div className="aviso-denegado-acciones">
        <button type="button" onClick={onValidar}>Autorizar</button>
        {onRestringir && !esAlerta && <button type="button" onClick={onRestringir}>Restringir</button>}
        <button type="button" className="enterado" onClick={onCerrar}><CheckCircle2 size={14} /> Enterado</button>
      </div>
    </div>
    <div className="aviso-denegado-controles">
      <button type="button" onClick={onCerrar} aria-label="Cerrar aviso"><X size={15} /></button>
      <button type="button" onClick={() => { const n = !sonido; fijarSonido(n); if (!n) detenerSonido(); }} aria-label={sonido ? 'Silenciar avisos' : 'Activar sonido'}>{sonido ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
    </div>
    {zoom && <VisorZoom d={d} onCerrar={() => setZoom(false)} />}
  </div>;
};

const AvisoAutorizado: React.FC<{ d: Deteccion; onCerrar: () => void; onConfirmar: (d: Deteccion) => void; onRestringir?: (d: Deteccion) => void }> = ({ d, onCerrar, onConfirmar, onRestringir }) => {
  const navigate = useNavigate();
  const confirmar = d.estado_validacion === 'pendiente_revision';
  // El aviso de confirmación permanece hasta que el personal actúe; el de autorizado se cierra solo
  useEffect(() => {
    if (confirmar) return;
    const t = window.setTimeout(onCerrar, 3500);
    return () => window.clearTimeout(t);
  }, [onCerrar, confirmar]);
  if (confirmar) {
    return (
      <div className="aviso-autorizado confirmar" role="alert">
        <span className="icono"><ShieldCheck size={24} /></span>
        <div style={{ minWidth: 0 }}>
          <strong>CONFIRME EL INGRESO</strong>
          <PlacaFoto d={d} alto={34} />
          <span className="detalle" style={{ whiteSpace: 'normal' }}>{d.motivo_revision}</span>
          <button className="btn btn-sm btn-exito" style={{ marginTop: 8 }} onClick={() => { onCerrar(); onConfirmar(d); }}>Autorizar</button>
          {onRestringir && <button className="btn btn-sm btn-danger" style={{ marginTop: 8 }} onClick={() => { onCerrar(); onRestringir(d); }}>Restringir</button>}
        </div>
        <button onClick={e => { e.stopPropagation(); onCerrar(); }} aria-label="Cerrar"><X size={15} /></button>
      </div>
    );
  }
  return (
    <div className="aviso-autorizado" role="status" onClick={() => { onCerrar(); navigate(`/detecciones/${d.id}`); }}>
      <span className="icono"><ShieldCheck size={24} /></span>
      <div style={{ minWidth: 0 }}>
        <strong>ACCESO AUTORIZADO{d.validado_manualmente ? ' · CONFIRMADO' : ''}</strong>
        <PlacaFoto d={d} alto={34} />
        <span className="detalle">{d.autorizado?.propietario ?? 'Padrón institucional'}{d.autorizado?.departamento ? ` · ${d.autorizado.departamento}` : ''}</span>
        <span className="detalle">{d.camara?.nombre ?? 'Acceso'} · {hora(d.fecha_hora_ingreso)}</span>
      </div>
      <button onClick={e => { e.stopPropagation(); onCerrar(); }} aria-label="Cerrar"><X size={15} /></button>
    </div>
  );
};

export const AvisosAcceso: React.FC = () => {
  const { puede } = useAuth();
  const { reconocerDeteccion } = useCentroNotificaciones();
  const [cola, setCola] = useState<Deteccion[]>([]);
  const [autorizados, setAutorizados] = useState<Deteccion[]>([]);
  const [validando, setValidando] = useState<Deteccion | null>(null);
  const [restringiendo, setRestringiendo] = useState<Deteccion | null>(null);
  const avisados = useRef(new Set<string>());
  const garita = puede('avisos:garita');

  const procesar = (d: Deteccion) => {
    if (!garita || d.estado_procesamiento !== 'procesado') return;
    const clave = `${d.id}:${d.estado_validacion}:${d.validado_manualmente ? 'm' : 'a'}`;
    if (avisados.current.has(clave)) return;
    // Autorizado confirmado por el personal: también suena (el guardia deja pasar al vehículo)
    if (d.validado_manualmente) {
      if (d.estado_validacion === 'autorizado' && reciente(d, 900)) {
        avisados.current.add(clave);
        setAutorizados(a => [...a.filter(x => x.estado_validacion === 'pendiente_revision'), d].slice(-3));
        sonarAutorizado();
      }
      return;
    }
    if (!reciente(d)) return;
    // Placa del padrón con confianza insuficiente (o vehículo distinto): pedir confirmación
    if (d.estado_validacion === 'pendiente_revision' && d.autorizado && d.motivo_revision) {
      avisados.current.add(clave);
      setAutorizados(a => [d, ...a.filter(x => x.id !== d.id)].slice(0, 3));
      return;
    }
    if (d.estado_validacion === 'alerta' || d.estado_validacion === 'no_reconocido') {
      avisados.current.add(clave);
      setCola(c => [...c.filter(x => x.id !== d.id), d]);
      sonarDenegado();
    } else if (d.estado_validacion === 'autorizado') {
      avisados.current.add(clave);
      setAutorizados(a => [...a.filter(x => x.estado_validacion === 'pendiente_revision'), d].slice(-3));
      sonarAutorizado();
    }
  };

  useEvento<Deteccion>('deteccion:actualizada', procesar);
  useEvento<Deteccion>('deteccion:alerta', procesar);
  // Si el personal corrige la lectura o se elimina el registro, el aviso deja de tener sentido
  useEvento<Deteccion>('deteccion:actualizada', d => { if (d.validado_manualmente) setCola(c => c.filter(x => x.id !== d.id)); });
  useEvento<{ id: number }>('deteccion:eliminada', ({ id }) => setCola(c => c.filter(x => x.id !== id)));
  useEvento('deteccion:eliminadas', () => { setCola([]); setAutorizados([]); });

  const actual = cola[0];
  // Cerrar el aviso = el personal lo atendió: ACK de las alarmas del paso (detiene el escalamiento)
  const reconocer = (d: Deteccion) => { void reconocerDeteccion(d.id).catch(() => undefined); };
  const cerrarActual = () => {
    if (actual) reconocer(actual);
    detenerSonido();
    setCola(c => c.slice(1));
    if (cola.length > 1) sonarDenegado();
  };
  const abrir = (accion: (d: Deteccion) => void) => () => { if (!actual) return; reconocer(actual); detenerSonido(); accion(actual); };
  if (!garita) return null;

  return (
    <>
      {(autorizados.length > 0 || actual) && (
        <div className="avisos-autorizados">
      {actual && !validando && !restringiendo && (
        <AvisoNoAutorizado d={actual} pendientes={cola.length - 1} onCerrar={cerrarActual}
          onValidar={abrir(setValidando)} onRestringir={puede('alertas:restringir') ? abrir(setRestringiendo) : undefined} />
      )}
          {autorizados.map(d => <AvisoAutorizado key={`${d.id}-${d.estado_validacion}`} d={d} onConfirmar={setValidando}
            onRestringir={puede('alertas:restringir') ? setRestringiendo : undefined}
            onCerrar={() => setAutorizados(a => a.filter(x => x.id !== d.id || x.estado_validacion !== d.estado_validacion))} />)}
        </div>
      )}
      {validando && <ValidarModal d={validando} onCerrar={() => setValidando(null)}
        onValidada={d => setCola(c => c.filter(x => x.id !== d.id))} />}
      {restringiendo && <RestringirVehiculoModal d={restringiendo} onCerrar={() => setRestringiendo(null)} onRestringido={() => setCola(c => c.filter(x => x.id !== restringiendo.id))} />}
    </>
  );
};
