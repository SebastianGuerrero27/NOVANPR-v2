import React from 'react';
import { REGLAS_VEHICULO } from '../../dominio/reglas';
import { MARCAS, TIPOS_VEHICULO } from '../../dominio/catalogoVehiculos';
import { CampoTexto } from './campos';
export interface VehiculoPermiso { tipo_vehiculo: string; marca: string; modelo: string; color: string }
export const CamposVehiculoPermiso: React.FC<{ prefijo: string; valor: VehiculoPermiso; onCambiar: (campo: keyof VehiculoPermiso, valor: string) => void; obligatorio?: boolean }> = ({ prefijo, valor, onCambiar, obligatorio = false }) => <>
  <CampoTexto id={`${prefijo}-tipo`} etiqueta={`Tipo de vehículo${obligatorio ? '*' : ''}`} valor={valor.tipo_vehiculo} onCambiar={v => onCambiar('tipo_vehiculo', v)} regla={{ ...REGLAS_VEHICULO.tipo_vehiculo, requerido: obligatorio }} opciones={TIPOS_VEHICULO} placeholder="Seleccione o escriba otro tipo" />
  <CampoTexto id={`${prefijo}-marca`} etiqueta={`Marca${obligatorio ? '*' : ''}`} valor={valor.marca} onCambiar={v => onCambiar('marca', v)} regla={{ ...REGLAS_VEHICULO.marca, requerido: obligatorio }} opciones={MARCAS} placeholder="Seleccione o escriba otra marca" />
  <CampoTexto id={`${prefijo}-modelo`} etiqueta={`Modelo${obligatorio ? '*' : ''}`} valor={valor.modelo} onCambiar={v => onCambiar('modelo', v)} regla={{ ...REGLAS_VEHICULO.modelo, requerido: obligatorio }} placeholder="Ej.: Aveo" />
  <CampoTexto id={`${prefijo}-color`} etiqueta={`Color${obligatorio ? '*' : ''}`} valor={valor.color} onCambiar={v => onCambiar('color', v)} regla={{ ...REGLAS_VEHICULO.color, requerido: obligatorio }} opciones={['blanco', 'negro', 'gris', 'plateado', 'rojo', 'azul', 'verde', 'amarillo', 'naranja', 'café', 'beige', 'vino']} placeholder="Seleccione o escriba el color" />
</>;
