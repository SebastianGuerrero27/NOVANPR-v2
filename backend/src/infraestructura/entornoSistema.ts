import type { PuertoEntorno } from '../aplicacion/configuracion';
import { cuentaVigente } from './servicios/emailService';
import { estadoServicioAnpr } from './servicios/servicioAnpr';
import { ZONA_HORARIA } from './servicios/tiempo';

/**
 * Datos del entorno de ejecución para la pantalla de configuración (solo lectura): zona
 * horaria, correo saliente vigente (de Configuración o de las variables SMTP_*), URL del
 * frontend y estado del motor ANPR.
 */
export const entornoSistema: PuertoEntorno = {
  async describir() {
    const anpr = await estadoServicioAnpr();
    const correo = cuentaVigente();
    return {
      zona_horaria: ZONA_HORARIA,
      correo_configurado: correo !== null,
      remitente_correo: correo?.remitenteCorreo ?? null,
      origen_correo: correo?.origen ?? null,
      frontend_url: process.env.FRONTEND_URL || null,
      entorno: process.env.NODE_ENV || 'development',
      anpr,
    };
  },
};
