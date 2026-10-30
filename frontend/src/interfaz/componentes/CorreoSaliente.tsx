import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Eye, EyeOff, Mail, Save, Send, Trash2 } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { fechaHora } from '../../dominio/formato';
import {
  erroresCorreo, type FormularioCorreo, PERFILES_SMTP, type PerfilSmtp, perfilDe, REMITENTE_POR_OMISION, seguridadDePuerto,
} from '../../dominio/correoSaliente';
import { errorDe, validarEmail } from '../../dominio/validacion';
import { Aviso, Confirmar, Interruptor, Tarjeta } from './ui';
import { CampoEntero, CampoTexto } from './campos';
import { useNotificar } from './Notificaciones';

/** GET /configuracion/correo: la cuenta guardada nunca trae la contraseña, solo si hay una. */
export interface EstadoCorreo {
  origen_vigente: 'sistema' | 'entorno' | null;
  cuenta_del_servidor: boolean;
  verificacion_exigida: boolean;
  guardado: null | {
    servidor: string; puerto: number; usuario: string; remitente_nombre: string; remitente_correo: string | null;
    habilitado: boolean; clave_guardada: boolean; clave_legible: boolean;
    actualizado_por: string | null; fecha_actualizacion: string | null;
    ultima_prueba: { fecha: string; ok: boolean; detalle: string } | null;
  };
}

const ORIGEN: Record<'sistema' | 'entorno', string> = { sistema: 'Cuenta de esta pantalla', entorno: 'Variables SMTP_* del servidor' };

function formularioDe(e: EstadoCorreo | null): FormularioCorreo & { habilitado: boolean } {
  const g = e?.guardado;
  return g
    ? { servidor: g.servidor, puerto: String(g.puerto), usuario: g.usuario, clave: '', remitente_nombre: g.remitente_nombre, remitente_correo: g.remitente_correo ?? '', habilitado: g.habilitado }
    : { servidor: PERFILES_SMTP.google.servidor, puerto: String(PERFILES_SMTP.google.puerto), usuario: '', clave: '', remitente_nombre: REMITENTE_POR_OMISION, remitente_correo: '', habilitado: true };
}

/**
 * Correo saliente (SMTP) en Configuración: la cuenta con que el sistema envía la verificación de
 * cuentas, la recuperación de contraseñas y las alarmas escaladas. La contraseña se escribe aquí,
 * se guarda cifrada y nunca vuelve al navegador. Con Gmail se usa una contraseña de aplicación.
 */
export const CorreoSaliente: React.FC<{ estado: EstadoCorreo; onCambio: (e: EstadoCorreo) => void }> = ({ estado, onCambio }) => {
  const { user } = useAuth();
  const notificar = useNotificar();
  const inicial = useMemo(() => formularioDe(estado), [estado]);
  const [f, setF] = useState(inicial);
  const [verClave, setVerClave] = useState(false);
  const [destino, setDestino] = useState(user?.email ?? '');
  const [enviando, setEnviando] = useState<'guardar' | 'probar' | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; detalle: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);
  useEffect(() => setF(inicial), [inicial]);

  const g = estado.guardado;
  const hayClave = Boolean(g?.clave_guardada && g.clave_legible);
  const errores = erroresCorreo(f, hayClave);
  const valido = Object.values(errores).every(x => !x);
  const cambios = (Object.keys(inicial) as (keyof typeof inicial)[]).some(k => f[k] !== inicial[k]);
  const perfil = perfilDe(f.servidor);
  const poner = (campo: keyof FormularioCorreo) => (v: string) => setF(x => ({ ...x, [campo]: v }));
  const elegirPerfil = (p: PerfilSmtp) => {
    if (p === 'otro') setF(x => ({ ...x, servidor: perfilDe(x.servidor) === 'otro' ? x.servidor : '' }));
    else setF(x => ({ ...x, servidor: PERFILES_SMTP[p].servidor, puerto: String(PERFILES_SMTP[p].puerto) }));
  };
  const errorDestino = errorDe(validarEmail(destino, 'Correo de destino'));

  const guardar = async () => {
    setEnviando('guardar'); setError(null); setResultado(null);
    try {
      const r = await api.put('/configuracion/correo', {
        servidor: f.servidor.trim(), puerto: Number(f.puerto), usuario: f.usuario.trim(), clave: f.clave,
        remitente_nombre: f.remitente_nombre.trim(), remitente_correo: f.remitente_correo.trim(), habilitado: f.habilitado,
      });
      onCambio(r.data.correo);
      notificar('exito', r.data.message, 'Envíe una prueba para confirmar que el servidor acepta la cuenta.');
    } catch (e) { setError(mensajeError(e)); } finally { setEnviando(null); }
  };

  const probar = async () => {
    setEnviando('probar'); setError(null); setResultado(null);
    try {
      const r = await api.post('/configuracion/correo/probar', { destino: destino.trim() });
      setResultado({ ok: r.data.ok, detalle: r.data.detalle });
      onCambio(r.data.correo);
    } catch (e) { setError(mensajeError(e)); } finally { setEnviando(null); }
  };

  const quitar = async () => {
    try {
      const r = await api.delete('/configuracion/correo');
      onCambio(r.data.correo);
      notificar('exito', r.data.message, r.data.correo.origen_vigente ? 'Rigen las variables SMTP_* del servidor.' : 'El sistema queda sin correo saliente.');
      setQuitando(false);
    } catch (e) { setError(mensajeError(e)); setQuitando(false); }
  };

  return (
    <Tarjeta titulo="Correo saliente (SMTP)" subtitulo="Verificación de cuentas, recuperación de contraseñas y alarmas escaladas"
      acciones={<span className="fila" style={{ gap: 6, fontSize: 12.5 }}>
        <span className={`punto ${estado.origen_vigente ? 'verde' : 'ambar'}`} />
        {estado.origen_vigente ? ORIGEN[estado.origen_vigente] : 'Sin configurar'} <Mail size={16} color="var(--text-3)" />
      </span>}>
      <div className="pila" style={{ gap: 14 }}>
        {!estado.origen_vigente && estado.verificacion_exigida && (
          <Aviso tipo="error">La verificación de correo está activa y no hay correo saliente: las cuentas nuevas no recibirán su enlace.</Aviso>
        )}
        {estado.origen_vigente === 'entorno' && !g && (
          <Aviso tipo="info">Hoy el correo sale con las variables SMTP_* del servidor. La cuenta que guarde aquí tiene prioridad sobre ellas.</Aviso>
        )}
        {g && !g.clave_legible && (
          <Aviso tipo="advertencia">La contraseña guardada no se puede descifrar (cambió la clave de cifrado del servidor): escríbala otra vez.</Aviso>
        )}

        <div className="fila" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Proveedor de correo">
          {(['google', 'microsoft', 'otro'] as PerfilSmtp[]).map(p => (
            <button key={p} type="button" className="btn btn-sm btn-secondary btn-opcion" aria-pressed={perfil === p} onClick={() => elegirPerfil(p)}>
              {p === 'otro' ? 'Otro servidor' : PERFILES_SMTP[p].etiqueta}
            </button>
          ))}
        </div>

        <div className="form-grid">
          <CampoTexto id="smtp-servidor" etiqueta="Servidor SMTP*" valor={f.servidor} onCambiar={poner('servidor')} literal
            regla={{ etiqueta: 'Servidor SMTP', tipo: 'libre', max: 253, requerido: true }} error={errores.servidor} placeholder="smtp.gmail.com" />
          <CampoEntero id="smtp-puerto" etiqueta="Puerto*" nombre="Puerto" valor={f.puerto} onCambiar={poner('puerto')} min={1} max={65535} requerido
            error={errores.puerto} ayuda={`${seguridadDePuerto(f.puerto)} · 587 (STARTTLS) o 465 (SSL)`} />
          <CampoTexto id="smtp-usuario" etiqueta="Correo de la cuenta*" tipo="email" valor={f.usuario} onCambiar={poner('usuario')}
            regla={{ etiqueta: 'Correo de la cuenta', tipo: 'libre', max: 150, requerido: true }} error={errores.usuario}
            placeholder="anpr.zonal3@gmail.com" autoComplete="off" />
          <div className="campo">
            <label htmlFor="smtp-clave">{perfil === 'google' ? 'Contraseña de aplicación*' : 'Contraseña*'}</label>
            <div style={{ position: 'relative' }}>
              <input id="smtp-clave" className="input mono" type={verClave ? 'text' : 'password'} value={f.clave} maxLength={128}
                onChange={e => poner('clave')(e.target.value)} autoComplete="new-password" spellCheck={false} style={{ paddingRight: 40 }}
                placeholder={hayClave ? 'Guardada · escriba solo para cambiarla' : perfil === 'google' ? 'xxxx xxxx xxxx xxxx' : ''}
                aria-invalid={f.clave && errores.clave ? true : undefined} aria-describedby="smtp-clave-ayuda" />
              <button type="button" className="btn btn-ghost btn-sm btn-icono" style={{ position: 'absolute', right: 4, top: 4 }}
                onClick={() => setVerClave(v => !v)} aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                {verClave ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <span id="smtp-clave-ayuda" className={f.clave && errores.clave ? 'error' : 'ayuda'}>
              {f.clave && errores.clave ? errores.clave : 'Se guarda cifrada y nunca se vuelve a mostrar.'}
            </span>
          </div>
          <CampoTexto id="smtp-nombre" etiqueta="Nombre del remitente" valor={f.remitente_nombre} onCambiar={poner('remitente_nombre')}
            regla={{ etiqueta: 'Nombre del remitente', tipo: 'libre', max: 100 }} error={errores.remitente_nombre} />
          <CampoTexto id="smtp-remitente" etiqueta="Correo del remitente" tipo="email" valor={f.remitente_correo} onCambiar={poner('remitente_correo')}
            regla={{ etiqueta: 'Correo del remitente', tipo: 'libre', max: 150 }} error={errores.remitente_correo}
            placeholder="Vacío: la cuenta" ayuda={perfil === 'google' ? 'Gmail solo acepta la cuenta o un alias verificado.' : undefined} />
        </div>

        {perfil === 'google' && (
          <div className="guia-smtp">
            <b>Contraseña de aplicación de Google</b>
            <ol>
              <li>En la cuenta de Google que enviará los correos, active la <b>verificación en dos pasos</b>.</li>
              <li>Abra <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Contraseñas de aplicación <ExternalLink size={11} /></a>, póngale un nombre (p. ej. «ANPR ECU 911») y pulse Crear.</li>
              <li>Copie las 16 letras aquí. No use la contraseña normal de la cuenta: Google la rechaza.</li>
            </ol>
          </div>
        )}

        <div className="fila" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="fila" style={{ gap: 10, fontSize: 13 }}>
            <Interruptor activo={f.habilitado} onCambiar={v => setF(x => ({ ...x, habilitado: v }))} etiqueta="Usar esta cuenta para el correo del sistema" />
            <span>Usar esta cuenta para el correo del sistema</span>
          </div>
          <div className="fila" style={{ gap: 8 }}>
            {g && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuitando(true)} disabled={enviando !== null}><Trash2 size={14} /> Quitar</button>}
            <button type="button" className="btn btn-navy" onClick={guardar} disabled={!valido || !cambios || enviando !== null}>
              <Save size={15} /> {enviando === 'guardar' ? 'Guardando…' : 'Guardar correo'}
            </button>
          </div>
        </div>

        <div className="prueba-smtp">
          <CampoTexto id="smtp-destino" etiqueta="Enviar un correo de prueba a" tipo="email" valor={destino} onCambiar={setDestino}
            regla={{ etiqueta: 'Correo de destino', tipo: 'libre', max: 150, requerido: true }} error={destino ? errorDestino : null}
            ayuda={cambios ? 'Guarde los cambios antes de probar: la prueba usa la cuenta guardada.' : undefined} />
          <button type="button" className="btn btn-secondary" onClick={probar}
            disabled={!estado.origen_vigente || cambios || Boolean(errorDestino) || enviando !== null}>
            <Send size={15} /> {enviando === 'probar' ? 'Enviando…' : 'Enviar prueba'}
          </button>
        </div>
        {resultado && <Aviso tipo={resultado.ok ? 'exito' : 'error'}>{resultado.detalle}</Aviso>}
        {!resultado && g?.ultima_prueba && (
          <p className="texto-secundario" style={{ fontSize: 12 }}>
            Última prueba {fechaHora(g.ultima_prueba.fecha)}: <b style={{ color: g.ultima_prueba.ok ? 'var(--autorizado)' : 'var(--alerta)' }}>{g.ultima_prueba.ok ? 'enviada' : 'fallida'}</b> · {g.ultima_prueba.detalle}
          </p>
        )}
        {g?.actualizado_por && <p style={{ fontSize: 11.5, color: 'var(--text-4)' }}>Guardada por {g.actualizado_por}, {fechaHora(g.fecha_actualizacion)}</p>}
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
      {quitando && (
        <Confirmar titulo="Quitar el correo saliente" peligro textoBoton="Quitar" onCerrar={() => setQuitando(false)} onConfirmar={quitar}
          mensaje={estado.cuenta_del_servidor
            ? <>Se borrará la cuenta <b>{g?.usuario}</b> y volverán a regir las variables SMTP_* del servidor.</>
            : <>Se borrará la cuenta <b>{g?.usuario}</b> y el sistema quedará <b>sin correo saliente</b>: no podrá enviar verificaciones ni recuperaciones de contraseña.</>} />
      )}
    </Tarjeta>
  );
};
