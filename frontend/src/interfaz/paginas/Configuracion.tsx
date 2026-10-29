import React, { useEffect, useMemo, useState } from 'react';
import { Cpu, Globe, Mail, RotateCcw, Save, Server } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useConsulta } from '../../aplicacion/hooks';
import type { EstadoAnpr } from '../../dominio/tipos';
import { fechaHora, numero } from '../../dominio/formato';
import { type ReglaTexto, errorDe, validarEntero, validarHost, validarTexto } from '../../dominio/validacion';
import { REGLA_PARAMETRO_TEXTO } from '../../dominio/reglas';
import { Aviso, Cargando, Interruptor, Tarjeta } from '../componentes/ui';
import { CampoEntero, CampoTexto } from '../componentes/campos';
import { CorreoSaliente, type EstadoCorreo } from '../componentes/CorreoSaliente';
import { useNotificar } from '../componentes/Notificaciones';

interface Parametro {
  clave: string; tipo: 'booleano' | 'entero' | 'lista' | 'texto' | 'opcion'; etiqueta: string; descripcion: string; grupo: string;
  min?: number; max?: number; opciones?: { valor: string; etiqueta: string }[]; valor: string; origen: 'sistema' | 'entorno' | 'omision';
  actualizado_por: string | null; fecha_actualizacion: string | null;
}
interface RespuestaConfig {
  parametros: Parametro[];
  entorno: { zona_horaria: string; correo_configurado: boolean; remitente_correo: string | null; frontend_url: string | null; entorno: string; anpr: EstadoAnpr };
}

const ORIGEN: Record<Parametro['origen'], string> = { sistema: 'Definido en esta pantalla', entorno: 'Variable de entorno del servidor', omision: 'Valor por omisión' };
const VERIFICACION_CORREO = 'registro_verificacion_email_habilitada';
/** Columnas de la pantalla: cuentas y correo a la izquierda, la operación a la derecha (una sola en pantallas angostas). */
const COLUMNA_IZQUIERDA = ['Acceso y cuentas'];

/** Dominios de correo separados por coma (la columna admite 500 caracteres). */
const reglaLista = (etiqueta: string): ReglaTexto => ({ etiqueta, tipo: 'libre', max: 500 });
const filtrarDominios = (v: string) => v.replace(/[^A-Za-z0-9.,@ -]/g, '');

/** Dominio de correo: nombre de host válido (no una IP) con dominio de nivel superior alfabético. */
const esDominioCorreo = (d: string) => {
  const host = validarHost(d);
  return host.ok && host.valor !== null && !/^[\d.]+$/.test(d) && /\.[a-z]{2,}$/i.test(d);
};

/**
 * Error del valor escrito, con las reglas de validarParametro (backend/src/dominio/configuracion.ts):
 * enteros dentro del rango, dominios de correo válidos (sin repetir, hasta 500 caracteres; vacío
 * acepta cualquier dominio) y texto de 1 a 150 caracteres.
 */
function errorParametro(p: Parametro, valor: string): string | null {
  if (p.tipo === 'entero') return errorDe(validarEntero(valor, { etiqueta: p.etiqueta, min: p.min, max: p.max, requerido: true }));
  if (p.tipo === 'texto') return errorDe(validarTexto(valor, { ...REGLA_PARAMETRO_TEXTO, etiqueta: p.etiqueta }));
  if (p.tipo === 'lista') {
    const dominios = [...new Set(valor.split(',').map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    if (!dominios.length) return valor.length > 500 ? `${p.etiqueta}: máximo 500 caracteres.` : null;
    const invalido = dominios.find(d => !esDominioCorreo(d));
    if (invalido !== undefined) return `${p.etiqueta}: dominio inválido (${invalido.substring(0, 60)}).`;
    if (dominios.join(',').length > 500) return `${p.etiqueta}: máximo 500 caracteres.`;
  }
  return null;
}

const Configuracion: React.FC = () => {
  const notificar = useNotificar();
  const { datos, cargando, error, setDatos } = useConsulta<RespuestaConfig>(() => api.get('/configuracion').then(r => r.data), []);
  const correo = useConsulta<EstadoCorreo>(() => api.get('/configuracion/correo').then(r => r.data), []);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  useEffect(() => { if (datos) setValores(Object.fromEntries(datos.parametros.map(p => [p.clave, p.valor]))); }, [datos]);
  const cambios = useMemo(() => (datos?.parametros ?? []).filter(p => valores[p.clave] !== undefined && valores[p.clave] !== p.valor), [datos, valores]);
  const grupos = useMemo(() => [...new Set((datos?.parametros ?? []).map(p => p.grupo))], [datos]);
  // La verificación de correo no se puede exigir sin correo saliente: el backend lo rechaza (400)
  const sinCorreo = correo.datos !== null && !correo.datos.origen_vigente;
  const errorDeParametro = (p: Parametro): string | null => {
    const valor = valores[p.clave] ?? '';
    if (p.clave === VERIFICACION_CORREO && valor === 'true' && p.valor !== 'true' && sinCorreo) {
      return 'Configure primero el correo saliente (SMTP): sin él, las cuentas nuevas no recibirían el enlace.';
    }
    return errorParametro(p, valor);
  };
  // Solo bloquea el guardado un valor cambiado: uno inválido que viene del servidor no impide guardar otros
  const conErrores = cambios.filter(p => errorDeParametro(p)).length;
  const poner = (clave: string) => (v: string) => setValores(x => ({ ...x, [clave]: v }));

  const guardar = async () => {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const r = await api.put('/configuracion', { valores: Object.fromEntries(cambios.map(p => [p.clave, valores[p.clave]])) });
      setDatos(d => d && { ...d, parametros: r.data.parametros });
      void correo.recargar(true);
      notificar('exito', r.data.message, 'Los cambios quedan registrados en la auditoría.');
    } catch (e) {
      setErrorGuardar(mensajeError(e));
    } finally { setGuardando(false); }
  };

  if (cargando && !datos) return <div className="pagina"><Cargando alto={300} /></div>;
  if (!datos) return <div className="pagina"><Aviso tipo="error">{error ?? 'No se pudo cargar la configuración.'}</Aviso></div>;
  const e = datos.entorno;
  const c = correo.datos;

  const tarjetaGrupo = (g: string) => (
    <Tarjeta key={g} titulo={g} sinPadding>
      {datos.parametros.filter(p => p.grupo === g).map(p => {
        const err = errorDeParametro(p);
        return (
          <div key={p.clave} className="parametro">
            <div className="parametro-texto">
              <label htmlFor={`cfg-${p.clave}`}>{p.etiqueta}</label>
              <p className="texto-secundario">{p.descripcion}</p>
              <p className="parametro-origen">{ORIGEN[p.origen]}{p.actualizado_por && ` · ${p.actualizado_por}, ${fechaHora(p.fecha_actualizacion)}`}</p>
              {p.tipo === 'booleano' && err && <p className="error" role="alert" style={{ marginTop: 6 }}>{err} <a href="#correo-saliente">Ir al correo saliente</a></p>}
            </div>
            <div className={`parametro-control${p.tipo === 'booleano' ? ' interruptor-derecha' : ''}`}>
              {p.tipo === 'booleano' ? (
                <Interruptor activo={valores[p.clave] === 'true'} onCambiar={v => setValores({ ...valores, [p.clave]: String(v) })} etiqueta={p.etiqueta} />
              ) : p.tipo === 'opcion' ? (
                <select id={`cfg-${p.clave}`} className="select" value={valores[p.clave] ?? ''} onChange={ev => setValores({ ...valores, [p.clave]: ev.target.value })}>
                  {p.opciones?.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                </select>
              ) : p.tipo === 'entero' ? (
                <CampoEntero id={`cfg-${p.clave}`} nombre={p.etiqueta} valor={valores[p.clave] ?? ''} onCambiar={poner(p.clave)}
                  min={p.min} max={p.max} requerido error={err} ayuda={`Entre ${p.min} y ${p.max}`} />
              ) : (
                <CampoTexto id={`cfg-${p.clave}`} valor={valores[p.clave] ?? ''} onCambiar={poner(p.clave)}
                  regla={p.tipo === 'lista' ? reglaLista(p.etiqueta) : { ...REGLA_PARAMETRO_TEXTO, etiqueta: p.etiqueta }}
                  error={err} filtrar={p.tipo === 'lista' ? filtrarDominios : undefined}
                  literal={p.tipo === 'lista'} ayuda={p.tipo === 'lista' ? 'Separados por coma; vacío acepta cualquier correo válido.' : undefined} />
              )}
            </div>
          </div>
        );
      })}
    </Tarjeta>
  );

  return (
    <div className="pagina ancha configuracion">
      <div className="config-resumen">
        <Tarjeta titulo="Motor ANPR" acciones={<Cpu size={17} color="var(--text-3)" />}>
          <dl className="definiciones">
            <dt>Estado</dt><dd><span className="fila" style={{ gap: 6 }}><span className={`punto ${e.anpr.en_linea ? 'verde' : 'rojo'}`} />{e.anpr.en_linea ? 'En línea' : e.anpr.error ?? 'Fuera de línea'}</span></dd>
            {e.anpr.en_linea && <>
              <dt>Captura</dt><dd>{numero(e.anpr.fps_captura ?? 0)} fps · análisis {numero(e.anpr.fps_procesamiento ?? 0)} fps</dd>
              <dt>Detector</dt><dd className="mono" style={{ fontSize: 12 }}>{e.anpr.detector ?? '—'}</dd>
              <dt>OCR</dt><dd className="mono" style={{ fontSize: 12 }}>{e.anpr.ocr ?? '—'}</dd>
              <dt>Verificador</dt><dd className="mono" style={{ fontSize: 12 }}>{e.anpr.verificador ?? '—'}</dd>
            </>}
          </dl>
          <p className="texto-secundario" style={{ marginTop: 12 }}>Los umbrales y modelos del motor se configuran en services/anpr/.env y requieren reiniciar el servicio.</p>
        </Tarjeta>
        <Tarjeta titulo="Correo electrónico" acciones={<Mail size={17} color="var(--text-3)" />}>
          <dl className="definiciones">
            <dt>SMTP</dt><dd><span className="fila" style={{ gap: 6 }}>
              <span className={`punto ${c?.origen_vigente ? 'verde' : 'ambar'}`} />
              {c?.origen_vigente === 'sistema' ? 'Configurado en esta pantalla' : c?.origen_vigente === 'entorno' ? 'Variables SMTP_* del servidor' : 'Sin configurar'}
            </span></dd>
            <dt>Cuenta</dt><dd>{c?.guardado?.habilitado ? c.guardado.usuario : e.remitente_correo ?? '—'}</dd>
            {c?.guardado?.ultima_prueba && <><dt>Última prueba</dt><dd>{c.guardado.ultima_prueba.ok ? 'Enviada' : 'Fallida'} · {fechaHora(c.guardado.ultima_prueba.fecha)}</dd></>}
          </dl>
          {c && !c.origen_vigente && <Aviso tipo="advertencia" style={{ marginTop: 12 }}>Sin SMTP los enlaces de verificación y recuperación solo se escriben en el registro del servidor. <a href="#correo-saliente">Configurarlo</a></Aviso>}
        </Tarjeta>
        <Tarjeta titulo="Servidor" acciones={<Server size={17} color="var(--text-3)" />}>
          <dl className="definiciones">
            <dt>Entorno</dt><dd>{e.entorno}</dd>
            <dt>Zona horaria</dt><dd>{e.zona_horaria}</dd>
            <dt>URL pública</dt><dd className="mono" style={{ fontSize: 12 }}><Globe size={12} style={{ verticalAlign: -1 }} /> {e.frontend_url ?? '—'}</dd>
          </dl>
        </Tarjeta>
      </div>

      <div className="config-columnas">
        <div className="pila">
          {grupos.filter(g => COLUMNA_IZQUIERDA.includes(g)).map(tarjetaGrupo)}
          <div id="correo-saliente">
            {c ? <CorreoSaliente estado={c} onCambio={correo.setDatos} />
              : correo.error ? <Aviso tipo="error">{correo.error}</Aviso> : <Cargando alto={200} />}
          </div>
        </div>
        <div className="pila">
          {grupos.filter(g => !COLUMNA_IZQUIERDA.includes(g)).map(tarjetaGrupo)}
        </div>
      </div>

      <div className="barra-guardar">
        {errorGuardar && <Aviso tipo="error">{errorGuardar}</Aviso>}
        <span className="texto-secundario">
          {cambios.length > 0 ? `${cambios.length} ${cambios.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}` : 'Parámetros sin cambios'}
          {conErrores > 0 && <span style={{ color: 'var(--alerta)' }}> · {conErrores === 1 ? '1 valor inválido' : `${conErrores} valores inválidos`}</span>}
        </span>
        <button className="btn btn-secondary" disabled={!cambios.length || guardando} onClick={() => setValores(Object.fromEntries(datos.parametros.map(p => [p.clave, p.valor])))}><RotateCcw size={15} /> Descartar</button>
        <button className="btn btn-navy" disabled={!cambios.length || conErrores > 0 || guardando} onClick={guardar}><Save size={15} /> {guardando ? 'Guardando…' : 'Guardar configuración'}</button>
      </div>
    </div>
  );
};

export default Configuracion;
