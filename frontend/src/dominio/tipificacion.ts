/**
 * Tipificación de un vehículo por su placa, según el marco normativo de matriculación del Ecuador
 * (tesis §1.3.10, Tablas 5 y 6 [29]): la primera letra indica la provincia y la segunda el tipo de
 * servicio; las series de las Fuerzas Armadas empiezan con F. Se deriva solo del texto de la placa,
 * así que vale también para los vehículos que no están en la lista blanca (p. ej., un vehículo de
 * gobierno que no está registrado).
 *
 * La Tabla 6 describe el formato vigente desde 2012 (tres letras y cuatro dígitos). En las placas
 * antiguas de tres dígitos la segunda letra no sigue esa tabla (en el video de la garita, PXJ-970 tiene
 * la franja blanca de un particular): se informa la provincia, no el servicio. Para las motocicletas la
 * tabla no indica el servicio y los prefijos diplomáticos no están especificados: no se infieren.
 */
import { normalizarPlaca, RE_PLACA_AUTO, RE_PLACA_MOTO } from './validacion';

export type CategoriaPlaca = 'particular' | 'gobierno' | 'oficial' | 'gad' | 'comercial' | 'fuerzas_armadas' | 'motocicleta' | 'antiguo';
/** Color de la franja superior donde aparece el nombre del país (Tabla 6) */
export type FranjaPlaca = 'oro' | 'verde_limon' | 'naranja' | 'blanco_plateado';

export interface Tipificacion {
  categoria: CategoriaPlaca;
  /** Para mostrar: "Vehículo particular", "Vehículo de gobierno"… */
  etiqueta: string;
  /** Versión corta en mayúsculas para el HUD del video */
  corta: string;
  /** Tipo de servicio de la Tabla 6 */
  servicio: string;
  /** null cuando la tabla no lo especifica */
  franja: FranjaPlaca | null;
  /** Vehículo de una entidad pública: gobierno central, uso oficial, GAD o Fuerzas Armadas */
  publico: boolean;
  /** Provincia de matriculación (Tabla 5); null si la letra no corresponde a una provincia */
  provincia: string | null;
}

/** Tabla 5: letra inicial de la placa por provincia */
export const PROVINCIAS: Readonly<Record<string, string>> = {
  A: 'Azuay', B: 'Bolívar', U: 'Cañar', C: 'Carchi', X: 'Cotopaxi', H: 'Chimborazo', O: 'El Oro', E: 'Esmeraldas',
  W: 'Galápagos', G: 'Guayas', I: 'Imbabura', L: 'Loja', R: 'Los Ríos', M: 'Manabí', V: 'Morona Santiago', N: 'Napo',
  S: 'Pastaza', P: 'Pichincha', Q: 'Orellana', K: 'Sucumbíos', T: 'Tungurahua', Z: 'Zamora Chinchipe', Y: 'Santa Elena',
  J: 'Santo Domingo de los Tsáchilas',
};

type Servicio = Omit<Tipificacion, 'provincia'>;

const GOBIERNO: Servicio = { categoria: 'gobierno', etiqueta: 'Vehículo de gobierno', corta: 'GOBIERNO', servicio: 'Gobierno central', franja: 'oro', publico: true };
const OFICIAL: Servicio = { categoria: 'oficial', etiqueta: 'Vehículo de uso oficial', corta: 'USO OFICIAL', servicio: 'Uso oficial', franja: 'oro', publico: true };
const GAD: Servicio = { categoria: 'gad', etiqueta: 'Vehículo de GAD', corta: 'GAD', servicio: 'Gobierno Autónomo Descentralizado (GAD)', franja: 'verde_limon', publico: true };
const COMERCIAL: Servicio = { categoria: 'comercial', etiqueta: 'Vehículo comercial', corta: 'COMERCIAL', servicio: 'Comercial (taxis y buses)', franja: 'naranja', publico: false };
const PARTICULAR: Servicio = { categoria: 'particular', etiqueta: 'Vehículo particular', corta: 'PARTICULAR', servicio: 'Particular', franja: 'blanco_plateado', publico: false };
const FUERZAS_ARMADAS: Servicio = { categoria: 'fuerzas_armadas', etiqueta: 'Vehículo de las Fuerzas Armadas', corta: 'FF. AA.', servicio: 'Fuerzas Armadas', franja: null, publico: true };
const MOTOCICLETA: Servicio = { categoria: 'motocicleta', etiqueta: 'Motocicleta', corta: 'MOTO', servicio: 'No determinado por la placa', franja: null, publico: false };
const ANTIGUO: Servicio = { categoria: 'antiguo', etiqueta: 'Placa de formato antiguo', corta: '', servicio: 'No determinado (la tabla de servicios es la del formato de 2012)', franja: null, publico: false };

/** Tabla 6: segunda letra → tipo de servicio; cualquier otra letra es particular */
const POR_SEGUNDA_LETRA: Readonly<Record<string, Servicio>> = { E: GOBIERNO, X: OFICIAL, M: GAD, A: COMERCIAL, U: COMERCIAL, Z: COMERCIAL };

/** Tipificación de una placa leída o escrita ("PEA-1234", "pea1234"); null si no tiene un formato ANT. */
export function tipificarPlaca(placa: unknown): Tipificacion | null {
  const p = normalizarPlaca(placa);
  if (RE_PLACA_MOTO.test(p)) return { ...MOTOCICLETA, provincia: null };
  if (!RE_PLACA_AUTO.test(p)) return null;
  if (p[0] === 'F') return { ...FUERZAS_ARMADAS, provincia: null };
  if (p.length === 6) return { ...ANTIGUO, provincia: PROVINCIAS[p[0]] ?? null };
  return { ...(POR_SEGUNDA_LETRA[p[1]] ?? PARTICULAR), provincia: PROVINCIAS[p[0]] ?? null };
}
