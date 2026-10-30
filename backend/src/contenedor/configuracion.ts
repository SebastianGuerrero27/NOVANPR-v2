import { casosConfiguracion } from '../aplicacion/configuracion';
import { auditoriaSql } from '../infraestructura/adaptadores';
import { entornoSistema } from '../infraestructura/entornoSistema';
import { cargarCorreoSaliente, repositorioCorreoSalienteSql } from '../infraestructura/persistencia/configuracionCorreoSql';
import { repositorioConfiguracionSql } from '../infraestructura/persistencia/configuracionSql';
import { cifrarSecreto } from '../infraestructura/servicios/custodiaCredenciales';
import { cuentaDelServidor, cuentaVigente, emailService } from '../infraestructura/servicios/emailService';

/**
 * Raíz de composición de la configuración del sistema: parámetros y correo saliente en
 * PostgreSQL (la contraseña SMTP cifrada con la custodia de credenciales) y entorno del servidor.
 */
export const configuracion = casosConfiguracion({
  repositorio: repositorioConfiguracionSql,
  entorno: entornoSistema,
  auditoria: auditoriaSql,
  correo: {
    repositorio: repositorioCorreoSalienteSql,
    servicio: {
      origen: () => cuentaVigente()?.origen ?? null,
      hayCuentaDelServidor: () => cuentaDelServidor() !== null,
      recargar: cargarCorreoSaliente,
      probar: emailService.probar,
      cifrar: cifrarSecreto,
    },
  },
});

export { cargarCorreoSaliente };
