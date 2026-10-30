/** La barra de pestañas sigue el orden del menú lateral: Gestión de Permisos va después de Lista negra. */
import { describe, expect, it } from 'vitest';
import type { Permiso } from '../src/dominio/permisos';
import { menuPara, pestanasPara } from '../src/interfaz/plantilla/navegacion';

const con = (...permisos: Permiso[]) => (p: Permiso) => permisos.includes(p);
const GUARDIA = con('operacion:monitorear', 'detecciones:validar', 'listas:ver', 'padron:gestionar', 'alertas:gestionar', 'solicitudes:crear');

describe('Barra de pestañas', () => {
  it('administrador: mismo orden que los módulos del menú lateral', () => {
    expect(pestanasPara(() => true).map(p => p.etiqueta)).toEqual([
      'Dashboard', 'Gestión de Accesos', 'Cámaras', 'Lista blanca', 'Lista negra', 'Gestión de Permisos',
      'Registro de Salidas', 'Historial', 'Reportes', 'Usuarios',
    ]);
    const ordenMenu = menuPara(() => true).flatMap(g => g.items.map(i => i.ruta));
    const rutas = pestanasPara(() => true).map(p => p.ruta);
    expect(rutas).toEqual(ordenMenu.filter(r => rutas.includes(r)));
  });

  it('guardia: solo sus vistas, en el mismo orden', () => {
    expect(pestanasPara(GUARDIA).map(p => p.etiqueta)).toEqual([
      'Dashboard', 'Gestión de Accesos', 'Lista blanca', 'Lista negra', 'Gestión de Permisos', 'Registro de Salidas', 'Historial',
    ]);
  });

  it('gestor de permisos: una sola vista, sin barra', () => {
    expect(pestanasPara(con('listas:ver', 'padron:gestionar', 'solicitudes:resolver'))).toEqual([]);
  });
});
