import React, { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useConsulta, usePaginaVisible } from '../../aplicacion/hooks';
import api from '../../infraestructura/api';
import { numero } from '../../dominio/formato';
import { Cargando, Tarjeta } from './ui';

interface UsoCpuServicio {
  servicio: 'equipo' | 'backend' | 'anpr';
  uso_pct: number | null;
}

interface RespuestaUsoCpu {
  cores_host: number | null;
  generado: string;
  servicios: UsoCpuServicio[];
}

const SERVICIOS: { clave: UsoCpuServicio['servicio']; nombre: string; detalle: string }[] = [
  { clave: 'equipo', nombre: 'Equipo completo', detalle: 'Todos los contenedores' },
  { clave: 'backend', nombre: 'Backend', detalle: 'API y procesos' },
  { clave: 'anpr', nombre: 'Motor ANPR', detalle: 'Detección y OCR' },
];

const CpuCircular: React.FC<{ nombre: string; detalle: string; valor: number | null }> = ({ nombre, detalle, valor }) => {
  const radio = 43;
  const circunferencia = 2 * Math.PI * radio;
  const porcentaje = valor === null ? 0 : Math.max(0, Math.min(100, valor));
  const color = valor === null ? 'var(--text-4)' : valor >= 85 ? 'var(--alerta)' : valor >= 60 ? 'var(--no-registrado)' : 'var(--autorizado)';

  return (
    <div className="tarjeta" style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
      <svg width="124" height="124" viewBox="0 0 120 120" role="img"
        aria-label={`${nombre}: ${valor === null ? 'sin datos' : `${porcentaje.toFixed(1)} % de la CPU del equipo`}`}>
        <circle cx="60" cy="60" r={radio} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
        {valor !== null && <circle cx="60" cy="60" r={radio} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circunferencia} strokeDashoffset={circunferencia * (1 - porcentaje / 100)} transform="rotate(-90 60 60)" />}
        <text x="60" y="57" textAnchor="middle" dominantBaseline="middle" fill="var(--text)" fontSize="20" fontWeight="700">
          {valor === null ? '—' : `${porcentaje.toFixed(1)}%`}
        </text>
        <text x="60" y="77" textAnchor="middle" dominantBaseline="middle" fill="var(--text-3)" fontSize="9">DEL EQUIPO</text>
      </svg>
      <div style={{ textAlign: 'center' }}>
        <strong>{nombre}</strong>
        <div className="texto-secundario" style={{ fontSize: 12 }}>{detalle}</div>
      </div>
    </div>
  );
};

const UsoCpu: React.FC = () => {
  const { datos, cargando, error, recargar } = useConsulta<RespuestaUsoCpu>(
    () => api.get('/panel/cpu').then(r => r.data), [],
  );
  const visible = usePaginaVisible();

  useEffect(() => {
    if (!visible) return;
    const intervalo = window.setInterval(() => { void recargar(true); }, 15_000);
    return () => window.clearInterval(intervalo);
  }, [recargar, visible]);

  const valor = (clave: UsoCpuServicio['servicio']) => datos?.servicios.find(s => s.servicio === clave)?.uso_pct ?? null;

  return (
    <Tarjeta titulo="Uso de CPU" subtitulo="Porcentaje de la capacidad total del equipo (todos sus núcleos)"
      acciones={<button className="btn btn-ghost btn-sm" onClick={() => { void recargar(); }} disabled={cargando}><RefreshCw size={14} /> Actualizar</button>}>
      {cargando && !datos ? <Cargando /> : (
        <>
          {error && <p role="alert" style={{ color: 'var(--alerta)', marginBottom: 12 }}>No se pudieron actualizar las métricas: {error}</p>}
          <div className="grid-3">
            {SERVICIOS.map(s => <CpuCircular key={s.clave} nombre={s.nombre} detalle={s.detalle} valor={valor(s.clave)} />)}
          </div>
          <p className="texto-secundario" style={{ fontSize: 12, marginTop: 12 }}>
            {datos?.cores_host ? `Equipo: ${numero(datos.cores_host)} núcleos lógicos · ` : ''}
            Se actualiza cada 15 segundos con el uso real desde la medición anterior. «—» indica que el servicio no respondió.
          </p>
        </>
      )}
    </Tarjeta>
  );
};

export default UsoCpu;
