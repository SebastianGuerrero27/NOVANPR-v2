import React from 'react';
import { REGLAS_LISTA_BLANCA } from '../../dominio/reglas';
import { CampoTexto } from './campos';
import { Aviso } from './ui';
export interface PersonaPermiso { propietario: string; cedula: string; institucion: string; cargo: string; departamento: string }
export const CamposPersonaPermiso: React.FC<{ prefijo: string; valor: PersonaPermiso; onCambiar: (campo: keyof PersonaPermiso, valor: string) => void; autoFocus?: boolean }> = ({ prefijo, valor, onCambiar, autoFocus }) => {
  return <>
  <CampoTexto id={`${prefijo}-cedula`} etiqueta="Cédula" valor={valor.cedula} onCambiar={v => onCambiar('cedula', v)} regla={REGLAS_LISTA_BLANCA.cedula} filtrar={v => v.replace(/\D/g, '').slice(0, 10)} placeholder="10 dígitos" ayuda="Opcional. Solo números; conserve los ceros iniciales." autoFocus={autoFocus} />
  <CampoTexto id={`${prefijo}-prop`} etiqueta="Nombres y apellidos*" valor={valor.propietario} onCambiar={v => onCambiar('propietario', v)} regla={REGLAS_LISTA_BLANCA.propietario} placeholder="Nombres y apellidos / institución" />
  {!!valor.cedula.trim() && !/^\d{10}$/.test(valor.cedula.trim()) && <div className="completo"><Aviso tipo="error">La cédula debe contener exactamente 10 dígitos, sin letras ni símbolos.</Aviso></div>}
  <CampoTexto id={`${prefijo}-institucion`} etiqueta="Institución" valor={valor.institucion} onCambiar={v => onCambiar('institucion', v)} regla={REGLAS_LISTA_BLANCA.institucion} placeholder="Ej.: ECU 911" />
  <CampoTexto id={`${prefijo}-cargo`} etiqueta="Cargo" valor={valor.cargo} onCambiar={v => onCambiar('cargo', v)} regla={REGLAS_LISTA_BLANCA.cargo} placeholder="Ej.: Analista de soporte zonal" />
  <CampoTexto id={`${prefijo}-dep`} etiqueta="Departamento o unidad" valor={valor.departamento} onCambiar={v => onCambiar('departamento', v)} regla={REGLAS_LISTA_BLANCA.departamento} placeholder="Ej.: Dirección Zonal, Proveedor" />
</>;
};
