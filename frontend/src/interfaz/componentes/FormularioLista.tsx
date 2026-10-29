import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Deteccion, Franja, RegistroLista } from '../../dominio/tipos';
import { fechaIsoLocal } from '../../dominio/formato';
import { errorDe, erroresTexto, normalizarPlaca, placaPropuesta, sinErrores, validarPlaca, valorPrecargado } from '../../dominio/validacion';
import { REGLA_MOTIVO_INGRESO, REGLA_OBSERVACIONES, REGLAS_LISTA_BLANCA, REGLAS_LISTA_NEGRA, REGLAS_VEHICULO } from '../../dominio/reglas';
import { Aviso, Modal } from './ui';
import { CampoPlaca, CampoTexto } from './campos';
import { horarioValido } from './EditorHorario';
import { CamposVehiculoPermiso } from './CamposVehiculoPermiso';
import { CamposFormularioPermiso } from './CamposFormularioPermiso';
import { EvidenciaListaNegra } from './EvidenciaListaNegra';
import { FotosEvidenciaLista } from './EvidenciaLista';
import { VigenciaPermiso } from './VigenciaPermiso';
import { EditorHorario } from './EditorHorario';

// Mismas marcas y colores que usa el reconocedor (services/anpr/app/data/catalogo_vehiculos_ecuador.json),
// para que lo registrado sea comparable con lo que observa la cámara.
export { MARCAS } from '../../dominio/catalogoVehiculos';
export const COLORES = ['blanco', 'negro', 'gris', 'plateado', 'rojo', 'azul', 'verde', 'amarillo', 'naranja', 'café', 'beige', 'vino'];

export type TipoLista = 'autorizados' | 'alertas';
export const RUTA_API: Record<TipoLista, string> = { autorizados: '/vehiculos-autorizados', alertas: '/blacklist' };

/** Opciones de una lista más el valor actual si no está en ella (p. ej. una marca informada por la cámara). */
export const conValorActual = (opciones: string[], valor: string) => (valor && !opciones.includes(valor) ? [valor, ...opciones] : opciones);

/**
 * Alta y edición de un permiso con vigencia y franjas horarias o de la lista de alertas.
 */
export const FormularioLista: React.FC<{
  tipo: TipoLista; registro?: RegistroLista; inicial?: Partial<Record<string, unknown>>;
  deteccion?: Deteccion;
  /** La evidencia solo se muestra cuando el formulario se abre desde Monitoreo. */
  mostrarEvidencia?: boolean;
  onCerrar: () => void; onGuardado: (r: RegistroLista) => void;
}> = ({ tipo, registro, inicial, deteccion, mostrarEvidencia = false, onCerrar, onGuardado }) => {
  // Registro guardado o valores propuestos (p. ej. desde una lectura): cada campo puede faltar
  const base: { [campo: string]: unknown } = { ...(registro ?? inicial) };
  const [f, setF] = useState({
    // Un registro guardado conserva su placa; una lectura de la cámara solo se propone si cabe en una placa
    placa: registro ? normalizarPlaca(registro.placa) : placaPropuesta(inicial?.placa),
    propietario: String(base.propietario ?? ''),
    cedula: String(base.cedula ?? ''),
    institucion: String(base.institucion ?? ''),
    cargo: String(base.cargo ?? ''),
    departamento: String(base.departamento ?? ''),
    tipo_vehiculo: valorPrecargado(base.tipo_vehiculo, REGLAS_VEHICULO.tipo_vehiculo),
    motivo: String(base.motivo ?? ''),
    nivel_alerta: String(base.nivel_alerta ?? 'ALTA'),
    marca: valorPrecargado(base.marca, REGLAS_VEHICULO.marca),
    modelo: String(base.modelo ?? ''),
    color: valorPrecargado(base.color, REGLAS_VEHICULO.color),
    fecha_vencimiento: String(base.fecha_vencimiento ?? base.fecha_fin ?? '').slice(0, 10),
    observaciones: String(base.observaciones ?? ''),
    motivo_ingreso: String(base.motivo_ingreso ?? ''),
    categoria: String(base.categoria ?? 'FUNCIONARIO'),
    fecha_inicio: String(base.fecha_inicio ?? '').slice(0, 10),
  });
  const [horario, setHorario] = useState<Franja[] | null>(registro?.horario ?? (Array.isArray(inicial?.horario) ? inicial.horario as Franja[] : null));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campo = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const poner = (k: keyof typeof f) => (v: string) => setF(x => ({ ...x, [k]: v }));
  const autorizados = tipo === 'autorizados';
  const placa = f.placa;
  const evidenciaRegistro = registro && (normalizarPlaca(placa) === normalizarPlaca(registro.placa) ? registro : {
    ...registro, placa: placa || null, imagen_vehiculo: null, imagen_placa: null,
    fecha_evidencia_vehiculo: null, fecha_evidencia_placa: null,
  });
  const hoy = fechaIsoLocal();
  const inicioEfectivo = f.fecha_inicio || hoy;
  const fechasOk = !f.fecha_vencimiento || inicioEfectivo <= f.fecha_vencimiento;
  // Mismas reglas que dominio/listas.ts: el botón se habilita solo si todo es válido
  const cedulaOk = !autorizados || !f.cedula.trim() || /^\d{10}$/.test(f.cedula.trim());
  const valido = cedulaOk && horarioValido(horario) && fechasOk && sinErrores({
    placa: !f.placa ? null : errorDe(validarPlaca(f.placa)),
    ...(autorizados ? erroresTexto(f, { ...REGLAS_LISTA_BLANCA, motivo_ingreso: REGLA_MOTIVO_INGRESO }) : erroresTexto(f, REGLAS_LISTA_NEGRA)),
    ...erroresTexto(f, { ...REGLAS_VEHICULO, observaciones: REGLA_OBSERVACIONES }),
  });

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    const cuerpo = autorizados
      ? {
        placa, propietario: f.propietario, cedula: f.cedula, institucion: f.institucion, cargo: f.cargo,
        departamento: f.departamento, categoria: f.categoria, tipo_vehiculo: f.tipo_vehiculo,
        marca: f.marca, modelo: f.modelo, color: f.color, fecha_inicio: f.fecha_inicio || null, fecha_vencimiento: f.fecha_vencimiento || null,
        horario, observaciones: f.observaciones, motivo_ingreso: f.motivo_ingreso,
      }
      : {
        placa, motivo: f.motivo, nivel_alerta: f.nivel_alerta, tipo_vehiculo: f.tipo_vehiculo,
        marca: f.marca, modelo: f.modelo, color: f.color, fecha_inicio: f.fecha_inicio || null,
        fecha_vencimiento: f.fecha_vencimiento || null, horario, observaciones: f.observaciones,
      };
    try {
      const r = registro ? await api.put(`${RUTA_API[tipo]}/${registro.id}`, cuerpo) : await api.post(RUTA_API[tipo], cuerpo);
      onGuardado(r.data.item);
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={`${registro ? `Editar registro de la ${autorizados ? 'lista blanca' : 'lista negra'}` : `Agregar ${autorizados ? 'permiso a la lista blanca' : 'placa a la lista negra'}`}`}
      subtitulo={autorizados ? 'Puede registrar solo el nombre y completar la placa cuando llegue la persona.' : 'Configure el motivo, el nivel y la vigencia. La placa es opcional si aún no ha sido identificada.'}
      onCerrar={onCerrar} bloquear={enviando} tamano="panoramico"
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className={`btn ${autorizados ? 'btn-navy' : 'btn-primary'}`} onClick={guardar} disabled={!valido || enviando}>{enviando && <Loader2 size={14} className="girar" />} Guardar</button>
      </>}>
      <div className="form-grid">
        {evidenciaRegistro && <FotosEvidenciaLista registro={evidenciaRegistro} />}
        {autorizados ? <CamposFormularioPermiso prefijo="l" valor={{ ...f, fecha_fin: f.fecha_vencimiento }}
          onCambiar={c => { const { fecha_fin, ...resto } = c; setF(x => ({ ...x, ...resto, ...(fecha_fin === undefined ? {} : { fecha_vencimiento: fecha_fin }) })); }}
          horario={horario} onHorario={setHorario} deteccion={deteccion} distribucion="panoramica" /> : <>
          <div className="completo formulario-permiso panoramico formulario-lista-negra">
            {!registro && mostrarEvidencia && <EvidenciaListaNegra placa={f.placa} deteccion={deteccion} />}
            <fieldset className="formulario-seccion">
              <legend>Identificación de la alerta</legend>
              <div className="form-grid">
                <CampoPlaca id="l-placa" etiqueta="Placa (opcional)" valor={f.placa} onCambiar={poner('placa')} requerido={false} autoFocus={!deteccion}
                  ayuda="Puede guardar la alerta sin placa y completarla cuando sea identificada." />
                <div className="campo"><label htmlFor="l-nivel">Nivel de alerta*</label><select id="l-nivel" className="select" value={f.nivel_alerta} onChange={campo('nivel_alerta')}><option value="CRITICA">Crítica</option><option value="ALTA">Alta</option><option value="MEDIA">Media</option></select></div>
                <CampoTexto id="l-motivo" className="completo" etiqueta="Motivo*" valor={f.motivo} onCambiar={poner('motivo')} regla={REGLAS_LISTA_NEGRA.motivo} />
                <CampoTexto id="l-obs" className="completo" etiqueta="Observaciones" valor={f.observaciones} onCambiar={poner('observaciones')} regla={REGLA_OBSERVACIONES} multilinea />
              </div>
            </fieldset>
            <fieldset className="formulario-seccion">
              <legend>Datos del vehículo</legend>
              <div className="form-grid"><CamposVehiculoPermiso prefijo="l" valor={f} onCambiar={(k, v) => setF(x => ({ ...x, [k]: v }))} /></div>
            </fieldset>
            <section className="permiso-condiciones" aria-label="Condiciones de la alerta">
              <VigenciaPermiso prefijo="l" titulo="Vigencia de la restricción" inicio={f.fecha_inicio} fin={f.fecha_vencimiento} onCambiar={(inicio, fin) => setF(x => ({ ...x, fecha_inicio: inicio, fecha_vencimiento: fin }))} />
              <fieldset className="formulario-seccion">
                <legend>Horario de la restricción</legend>
                <EditorHorario valor={horario} onCambiar={setHorario} restriccion />
              </fieldset>
            </section>
          </div>
        </>}
        {error && <div className="completo"><Aviso tipo="error">{error}</Aviso></div>}
      </div>
    </Modal>
  );
};

export const CompletarPlaca: React.FC<{ registro: RegistroLista; onCerrar: () => void; onGuardado: () => void }> = ({ registro, onCerrar, onGuardado }) => {
  const [placa, setPlaca] = useState('');
  const [confirmada, setConfirmada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setEnviando(true); setError(null);
    try {
      await api.post(`/vehiculos-autorizados/${registro.id}/placa`, { placa, identidad_confirmada: confirmada });
      onGuardado();
    } catch (e) { setError(mensajeError(e)); setEnviando(false); }
  };
  return <Modal titulo="Completar placa del permiso" subtitulo={registro.propietario ?? ''} onCerrar={onCerrar} bloquear={enviando}
    pie={<><button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button><button className="btn btn-navy" disabled={enviando || !confirmada || !validarPlaca(placa).ok} onClick={guardar}>Guardar placa</button></>}>
    <div className="pila">
      <Aviso tipo="info">Confirme que quien llega es <b>{registro.propietario}</b> y que esta placa corresponde a su vehículo. Se conservarán la vigencia y el horario otorgados por el gestor.</Aviso>
      <CampoPlaca id="completar-placa" etiqueta="Placa del vehículo*" valor={placa} onCambiar={setPlaca} autoFocus />
      <label className="fila"><input type="checkbox" checked={confirmada} onChange={e => setConfirmada(e.target.checked)} /> Verifiqué la identidad de la persona y su vehículo.</label>
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  </Modal>;
};
