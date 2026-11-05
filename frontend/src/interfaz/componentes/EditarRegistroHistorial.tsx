import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Deteccion } from '../../dominio/tipos';
import { fechaHora } from '../../dominio/formato';
import { MARCAS, TIPOS_VEHICULO } from '../../dominio/catalogoVehiculos';
import { REGLAS_LISTA_BLANCA, REGLAS_VEHICULO, REGLA_MOTIVO_AUDITORIA, REGLA_MOTIVO_INGRESO, REGLA_PERSONA_INGRESO } from '../../dominio/reglas';
import { formatearPlaca, normalizarPlaca, soloDigitos, validarPlaca, validarTexto, type ReglaTexto } from '../../dominio/validacion';
import { CampoTexto, filtrarEscrito } from './campos';
import { ImagenEvidencia, recortePlaca } from './deteccion';
import { Aviso, InsigniaEstado, Modal } from './ui';
import { VisorZoom } from './ZoomDual';
import { useNotificar } from './Notificaciones';
import './EditarRegistroHistorial.css';

type CampoFicha = 'cedula' | 'persona_ingreso' | 'motivo_ingreso' | 'tipo_vehiculo' | 'marca' | 'modelo' | 'color';
const REGLAS: Record<CampoFicha, ReglaTexto> = {
  cedula: REGLAS_LISTA_BLANCA.cedula, persona_ingreso: REGLA_PERSONA_INGRESO,
  motivo_ingreso: REGLA_MOTIVO_INGRESO, ...REGLAS_VEHICULO,
};
const texto = (v: string) => v.trim().replace(/\s+/g, ' ');

/** Corrige la ficha histórica; no usa la autorización operativa ni modifica la lista blanca. */
export const EditarRegistroHistorial: React.FC<{
  d: Deteccion; onCerrar: () => void; onGuardado: (d: Deteccion) => void;
}> = ({ d, onCerrar, onGuardado }) => {
  const notificar = useNotificar();
  const [inicial] = useState<Record<CampoFicha, string>>(() => ({
    cedula: d.datos_permiso?.cedula ?? '', persona_ingreso: d.persona_ingreso ?? d.autorizado?.propietario ?? '',
    motivo_ingreso: d.motivo_ingreso ?? '', tipo_vehiculo: d.tipo_vehiculo ?? d.vehiculo?.tipo ?? '',
    marca: d.vehiculo?.marca ?? '', modelo: d.vehiculo?.modelo ?? '', color: d.vehiculo?.color ?? '',
  }));
  const [ficha, setFicha] = useState(inicial);
  const [placa, setPlaca] = useState(() => formatearPlaca(d.placa));
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const esSalida = d.tipo_movimiento === 'salida';
  const cambiaPlaca = !esSalida && normalizarPlaca(placa) !== normalizarPlaca(d.placa);
  const modificados = (Object.keys(REGLAS) as CampoFicha[]).filter(k => texto(ficha[k]) !== texto(inicial[k]));
  const valido = (cambiaPlaca || modificados.length > 0) && validarTexto(motivo, REGLA_MOTIVO_AUDITORIA).ok
    && (!cambiaPlaca || !placa.trim() || validarPlaca(placa).ok)
    && modificados.every(k => validarTexto(ficha[k], REGLAS[k]).ok
      && (k !== 'cedula' || !ficha[k] || /^\d{10}$/.test(ficha[k])));
  const cambiar = (campo: CampoFicha, valor: string) => setFicha(actual => ({ ...actual, [campo]: valor }));
  const guardar = async () => {
    if (!valido || enviando) return;
    setEnviando(true); setError(null);
    try {
      const cambios = Object.fromEntries(modificados.map(k => [k, texto(ficha[k])]));
      const { data } = await api.patch<{ deteccion: Deteccion }>(`/detecciones/${d.id}/registro`, {
        ...cambios, ...(cambiaPlaca ? { placa: normalizarPlaca(placa) } : {}), motivo_correccion: texto(motivo),
      });
      notificar('exito', `Registro #${d.id} actualizado`, 'La corrección quedó registrada en la auditoría.');
      onGuardado(data.deteccion);
      onCerrar();
    } catch (e) { setError(mensajeError(e)); setEnviando(false); }
  };
  return <>
    <Modal titulo="Editar registro del historial" subtitulo={`#${d.id} · ${fechaHora(d.fecha_hora_ingreso)} · ${d.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso'}`}
      tamano="panoramico" onCerrar={zoom ? () => setZoom(false) : onCerrar} bloquear={enviando} pie={<>
        <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button type="button" className="btn btn-navy" onClick={() => void guardar()} disabled={!valido || enviando}>
          {enviando && <Loader2 size={14} className="girar" />} Guardar cambios</button>
      </>}>
      <div className="editor-registro-layout">
        <div className="pila">
          <div className="form-grid">
            <div className="campo">
              <label htmlFor="hist-placa">Placa</label>
              <input id="hist-placa" className="input placa-input" value={placa} maxLength={20} disabled={enviando || esSalida}
                autoComplete="off" spellCheck={false} onChange={e => setPlaca(filtrarEscrito(e.target, normalizarPlaca))}
                aria-invalid={cambiaPlaca && Boolean(placa) && !validarPlaca(placa).ok || undefined} aria-describedby="hist-placa-ayuda" />
              <span id="hist-placa-ayuda" className={cambiaPlaca && placa && !validarPlaca(placa).ok ? 'error' : 'ayuda'}>
                {esSalida ? 'Para corregir la placa de una salida, use su validación.' : cambiaPlaca && placa && !validarPlaca(placa).ok ? 'Use ABC-1234, ABC-123 o AB-123C.' : 'Deje el campo vacío únicamente si la placa no es legible.'}
              </span>
            </div>
            <CampoTexto id="hist-cedula" etiqueta="Cédula" valor={ficha.cedula} onCambiar={v => cambiar('cedula', soloDigitos(v))}
              regla={REGLAS.cedula} deshabilitado={enviando} ayuda="10 dígitos, conservando los ceros iniciales." />
            <CampoTexto id="hist-persona" className="completo" etiqueta="Nombres y apellidos" valor={ficha.persona_ingreso}
              onCambiar={v => cambiar('persona_ingreso', v)} regla={REGLAS.persona_ingreso} deshabilitado={enviando} />
            <CampoTexto id="hist-tipo" etiqueta="Vehículo" valor={ficha.tipo_vehiculo} onCambiar={v => cambiar('tipo_vehiculo', v)}
              regla={REGLAS.tipo_vehiculo} opciones={TIPOS_VEHICULO} deshabilitado={enviando} />
            <CampoTexto id="hist-marca" etiqueta="Marca" valor={ficha.marca} onCambiar={v => cambiar('marca', v)}
              regla={REGLAS.marca} opciones={MARCAS} deshabilitado={enviando} />
            <CampoTexto id="hist-modelo" etiqueta="Modelo" valor={ficha.modelo} onCambiar={v => cambiar('modelo', v)}
              regla={REGLAS.modelo} deshabilitado={enviando} />
            <CampoTexto id="hist-color" etiqueta="Color" valor={ficha.color} onCambiar={v => cambiar('color', v)}
              regla={REGLAS.color} deshabilitado={enviando} />
            <CampoTexto id="hist-motivo" className="completo" etiqueta="Motivo del ingreso" valor={ficha.motivo_ingreso}
              onCambiar={v => cambiar('motivo_ingreso', v)} regla={REGLAS.motivo_ingreso} deshabilitado={enviando} />
            <CampoTexto id="hist-correccion" className="completo" etiqueta="Motivo de la corrección*" valor={motivo} onCambiar={setMotivo}
              regla={REGLA_MOTIVO_AUDITORIA} deshabilitado={enviando} multilinea ayuda="Explique la corrección. Queda en la auditoría con su usuario." />
          </div>
          {cambiaPlaca && d.tipo_movimiento !== 'salida' && <Aviso tipo="advertencia">Al cambiar la placa, el ingreso quedará pendiente de revisión. Revise su autorización desde la gestión de accesos.</Aviso>}
          {error && <Aviso tipo="error">{error}</Aviso>}
        </div>
        <aside className="editor-registro-evidencia" aria-label="Evidencia original del registro">
          <InsigniaEstado estado={d.estado_validacion} />
          <p className="texto-secundario">Lectura del motor: <b>{d.placa_reconocida ? formatearPlaca(d.placa_reconocida) : 'Sin lectura'}</b></p>
          <figure><figcaption className="etiqueta-campo">Foto del vehículo</figcaption>
            <ImagenEvidencia ruta={d.imagen_vehiculo} alt="Foto original del vehículo" alto={160} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} /></figure>
          <figure><figcaption className="etiqueta-campo">Foto de la placa</figcaption>
            <ImagenEvidencia ruta={recortePlaca(d)} alt="Recorte original de la placa" alto={90} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} /></figure>
          {(d.imagen_vehiculo || d.imagen_placa) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setZoom(true)}>Ampliar fotos</button>}
        </aside>
      </div>
    </Modal>
    {zoom && <VisorZoom d={d} onCerrar={() => setZoom(false)} />}
  </>;
};
