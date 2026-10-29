import React, { useEffect, useId, useRef, useState } from 'react';
import type { Deteccion } from '../../dominio/tipos';
import { MARCAS, TIPOS_VEHICULO } from '../../dominio/catalogoVehiculos';
import { MOTIVOS_INGRESO_FRECUENTES, REGLAS_LISTA_BLANCA, REGLAS_VEHICULO, REGLA_PERSONA_INGRESO, REGLA_MOTIVO_INGRESO } from '../../dominio/reglas';
import { type ReglaTexto, filtrarTexto, soloDigitos, validarTexto } from '../../dominio/validacion';
import api, { mensajeError } from '../../infraestructura/api';
import { filtrarEscrito } from './campos';

export type CampoIngreso = 'cedula' | 'persona_ingreso' | 'tipo_vehiculo' | 'marca' | 'modelo' | 'motivo_ingreso';

const CAMPOS: Record<CampoIngreso, { etiqueta: string; regla: ReglaTexto; opciones?: string[] }> = {
  cedula: { etiqueta: 'Cédula', regla: REGLAS_LISTA_BLANCA.cedula },
  persona_ingreso: { etiqueta: 'Titular', regla: REGLA_PERSONA_INGRESO },
  tipo_vehiculo: { etiqueta: 'Vehículo', regla: REGLAS_VEHICULO.tipo_vehiculo, opciones: TIPOS_VEHICULO },
  marca: { etiqueta: 'Marca', regla: REGLAS_VEHICULO.marca, opciones: MARCAS },
  modelo: { etiqueta: 'Modelo', regla: REGLAS_VEHICULO.modelo },
  motivo_ingreso: { etiqueta: 'Motivo', regla: REGLA_MOTIVO_INGRESO, opciones: MOTIVOS_INGRESO_FRECUENTES },
};

function valorCampo(d: Deteccion, campo: CampoIngreso): string {
  if (campo === 'cedula') return d.datos_permiso?.cedula ?? '';
  if (campo === 'persona_ingreso') return d.persona_ingreso ?? d.autorizado?.propietario ?? '';
  if (campo === 'tipo_vehiculo') return d.tipo_vehiculo ?? d.vehiculo.tipo ?? '';
  if (campo === 'motivo_ingreso') return d.motivo_ingreso ?? '';
  return d.vehiculo[campo] ?? '';
}

/** Una respuesta de guardado solo reemplaza su campo, conservando las demás celdas editadas. */
export function actualizarCampoIngreso(anterior: Deteccion, actualizada: Deteccion, campo?: CampoIngreso): Deteccion {
  if (!campo) return actualizada;
  const cambios: Partial<Deteccion> = {
    registro_completo: actualizada.registro_completo, datos_faltantes_registro: actualizada.datos_faltantes_registro,
    estado_validacion: actualizada.estado_validacion,
    estado_procesamiento: actualizada.estado_procesamiento,
    autorizado: actualizada.autorizado,
    validado_manualmente: actualizada.validado_manualmente,
    restriccion_acceso: actualizada.restriccion_acceso,
  };
  if (campo === 'cedula') cambios.datos_permiso = { ...anterior.datos_permiso, cedula: actualizada.datos_permiso?.cedula ?? '' };
  else if (campo === 'persona_ingreso') {
    cambios.persona_ingreso = actualizada.persona_ingreso;
    cambios.datos_permiso = { ...anterior.datos_permiso, propietario: actualizada.persona_ingreso ?? '' };
  } else if (campo === 'motivo_ingreso') cambios.motivo_ingreso = actualizada.motivo_ingreso;
  else {
    cambios.vehiculo = { ...anterior.vehiculo, [campo === 'tipo_vehiculo' ? 'tipo' : campo]: campo === 'tipo_vehiculo' ? actualizada.tipo_vehiculo : actualizada.vehiculo[campo] };
    if (campo === 'tipo_vehiculo') cambios.tipo_vehiculo = actualizada.tipo_vehiculo;
    cambios.datos_permiso = { ...anterior.datos_permiso, [campo]: actualizada.datos_permiso?.[campo] ?? (campo === 'tipo_vehiculo' ? actualizada.tipo_vehiculo : actualizada.vehiculo[campo]) ?? '' };
  }
  return { ...anterior, ...cambios };
}

/** Input permanente: Enter o salir de la celda guarda; Escape restaura el último dato guardado. */
export const CeldaIngreso: React.FC<{
  d: Deteccion; campo: CampoIngreso; editable: boolean;
  onActualizada: (d: Deteccion, campo?: CampoIngreso) => void;
}> = ({ d, campo, editable, onActualizada }) => {
  const { etiqueta, regla, opciones } = CAMPOS[campo];
  const recibido = valorCampo(d, campo);
  const [valor, setValor] = useState(recibido);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const borrador = useRef(recibido);
  const persistido = useRef(recibido);
  const modificado = useRef(false);
  const pendiente = useRef(false);
  const peticion = useRef(false);
  const enviado = useRef<string | null>(null);
  const enfocado = useRef(false);

  // Las actualizaciones en vivo no sustituyen lo que el operador está escribiendo.
  useEffect(() => {
    if (modificado.current || peticion.current || enfocado.current) return;
    persistido.current = recibido;
    borrador.current = recibido;
    setValor(recibido);
  }, [recibido]);

  const guardar = async () => {
    if (!editable) return;
    if (peticion.current) {
      pendiente.current = borrador.current.trim().replace(/\s+/g, ' ') !== enviado.current;
      return;
    }
    const validado = validarTexto(borrador.current, regla);
    if (!validado.ok) { setError(validado.error); return; }
    const nuevo = validado.valor ?? '';
    if (campo === 'cedula' && nuevo && !/^\d{10}$/.test(nuevo)) {
      setError('La cédula debe contener exactamente 10 dígitos.');
      return;
    }
    if (nuevo === persistido.current) {
      borrador.current = nuevo;
      modificado.current = false;
      setValor(nuevo);
      setError(null);
      return;
    }
    peticion.current = true;
    enviado.current = nuevo;
    pendiente.current = false;
    setGuardando(true);
    setError(null);
    try {
      const { data } = await api.patch<{ deteccion: Deteccion }>(`/detecciones/${d.id}/ingreso`, { [campo]: nuevo });
      const guardado = valorCampo(data.deteccion, campo);
      persistido.current = guardado;
      if (borrador.current.trim().replace(/\s+/g, ' ') === nuevo) {
        borrador.current = guardado;
        setValor(guardado);
      }
      modificado.current = borrador.current !== guardado;
      onActualizada(data.deteccion, campo);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      peticion.current = false;
      enviado.current = null;
      setGuardando(false);
      if (pendiente.current && modificado.current && !enfocado.current) {
        pendiente.current = false;
        void guardar();
      }
    }
  };

  return <td className={`celda-ingreso${campo === 'persona_ingreso' ? ' celda-titular' : ''}`}
    onClick={e => { e.stopPropagation(); if (editable) input.current?.focus(); }} onKeyDown={e => e.stopPropagation()}>
    <>
      <input ref={input} className={`input input-celda${campo === 'cedula' ? ' cedula-input' : ''}`} aria-label={`${etiqueta} del registro ${d.id}`}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        aria-busy={guardando || undefined} readOnly={!editable} value={valor} maxLength={regla.max} inputMode={campo === 'cedula' ? 'numeric' : undefined}
        placeholder={campo === 'cedula' ? '10 dígitos' : etiqueta} title={valor || etiqueta} autoComplete="off" list={opciones ? `${id}-opciones` : undefined}
        onFocus={() => { enfocado.current = true; }}
        onChange={e => {
          if (!editable) return;
          const nuevo = filtrarEscrito(e.target, v => campo === 'cedula' ? soloDigitos(v) : filtrarTexto(v, regla.tipo));
          borrador.current = nuevo;
          modificado.current = nuevo !== persistido.current;
          setValor(nuevo);
          setError(null);
        }}
        onBlur={() => { enfocado.current = false; void guardar(); }}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); void guardar(); e.currentTarget.blur(); }
          if (e.key === 'Escape') {
            e.preventDefault();
            borrador.current = persistido.current;
            modificado.current = false;
            pendiente.current = false;
            setValor(persistido.current);
            setError(null);
            e.currentTarget.blur();
          }
        }} />
      {opciones && <datalist id={`${id}-opciones`}>{opciones.map(v => <option key={v} value={v} />)}</datalist>}
      {error && <span className="error error-celda" id={`${id}-error`} role="alert">{error}</span>}
      {guardando && <span className="estado-celda" role="status">Guardando…</span>}
    </>
  </td>;
};
