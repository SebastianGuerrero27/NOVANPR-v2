import React from 'react';
import type { Deteccion } from '../../dominio/tipos';
import { FormularioLista } from './FormularioLista';
import { useNotificar } from './Notificaciones';
export const RestringirVehiculoModal: React.FC<{ d: Deteccion; onCerrar: () => void; onRestringido?: () => void }> = ({ d, onCerrar, onRestringido }) => {
  const notificar = useNotificar();
  return <FormularioLista tipo="alertas" deteccion={d} mostrarEvidencia
    inicial={{ placa: d.placa, tipo_vehiculo: d.tipo_vehiculo || d.vehiculo?.tipo,
      marca: d.vehiculo?.marca, modelo: d.vehiculo?.modelo, color: d.vehiculo?.color }}
    onCerrar={onCerrar} onGuardado={() => {
      notificar('exito', 'Placa agregada a la lista negra', 'Los próximos accesos de esta placa generarán una alerta.');
      onRestringido?.(); onCerrar();
    }} />;
};
