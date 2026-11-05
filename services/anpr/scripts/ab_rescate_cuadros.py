"""
A/B pareado del rescate de cuadros (app/aplicacion/motor.py, _rescatar_cuadros y _otro_intento).

El motor de producción recorre cada paso etiquetado de un video: un tramo por paso, con un margen
antes y después. El detector queda limitado a --tope-analisis cuadros por segundo para reproducir la
CPU ocupada de la operación en vivo; con dos cámaras en el portátil son ~3,5 análisis por segundo.

Condiciones:
  A: sin rescate (rescate_cuadros=False), como antes.
  B: con rescate. Se suman como candidatos a la foto los cuadros que el detector no analizó, con la
     caja del flujo óptico, y si el vehículo ya salió se lee otra de sus fotos.

Cada paso se evalúa --repeticiones veces en cada condición, alternando el orden A/B. Qué cuadros
alcanzan a analizarse cambia entre corridas, por eso se repite.

Por paso legible y corrida se mide si se registró la placa exacta. Prueba de McNemar exacta sobre los
pares discordantes (paso, repetición). También se informa:
- pasos con algún registro;
- registros fuera de los pasos y registros de pasos no legibles;
- duplicados;
- latencia de la captura al registro;
- cuadros rescatados y otras fotos leídas.

El informe no lleva placas: los pasos se identifican por su número.

Uso (dentro del contenedor del motor, donde están los modelos):
    python scripts/ab_rescate_cuadros.py /eval/secuencia.json --videos /videos --repeticiones 4 \\
        --tope-analisis 3.5 --salida /eval/ab_rescate.json
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import os
import statistics
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.estadistica import mcnemar_exact  # noqa: E402
from scripts.evaluar_secuencias import crear_motor_de_evaluacion, evaluar, wilson  # noqa: E402

CONDICIONES = {"A": False, "B": True}


def tramos(etiqueta: dict, margen: float, carpeta: str) -> list[tuple[dict, str]]:
    """Un JSON de secuencia por paso: el tramo del video con el paso y `margen` segundos a cada lado."""
    salida = []
    for k, p in enumerate(etiqueta["pasos"]):
        numero = p.get("paso", k + 1)
        tramo = dict(etiqueta, secuencia=f"paso_{numero}", desde_s=max(0.0, p["inicio_s"] - margen), hasta_s=p["fin_s"] + margen)
        ruta = os.path.join(carpeta, f"paso_{numero}.json")
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(tramo, f, ensure_ascii=False)
        salida.append((p, ruta))
    return salida


def resultado_del_paso(r: dict, paso: dict) -> dict:
    """Lo que interesa del paso del tramo (el tramo puede incluir parte de otro paso)."""
    limpia = paso["placa"].replace("-", "").upper()
    detalle = next(d for d in r["detalle_pasos"] if d["placa"] == paso["placa"])
    return {
        "exacta": limpia in detalle["registros"],
        "registrado": bool(detalle["registros"]),
        "registros": len(detalle["registros"]),
        "valida": detalle["valida"],
        "lat_registro_s": detalle["lat_registro_s"],
        "sin_paso": r["registros_sin_paso"],
        "rescate": r.get("rescate") or {},
        "fps_analizados": r["fps_analizados"],
        "etapas_p50_ms": {k: v.get("p50_ms") for k, v in (r.get("etapas_ms") or {}).items() if isinstance(v, dict)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("etiqueta", help="JSON de la secuencia completa")
    ap.add_argument("--videos", required=True, help="Carpeta del video")
    ap.add_argument("--repeticiones", type=int, default=4)
    ap.add_argument("--tope-analisis", type=float, default=3.5)
    ap.add_argument("--margen", type=float, default=3.0, help="Segundos de video antes y después de cada paso")
    ap.add_argument("--pasos", default="", help="Números de paso a evaluar, separados por comas (vacío: todos)")
    ap.add_argument("--salida", default=None)
    a = ap.parse_args()

    with open(a.etiqueta, encoding="utf-8") as f:
        etiqueta = json.load(f)
    if a.pasos:
        elegidos = {int(x) for x in a.pasos.split(",")}
        etiqueta["pasos"] = [p for p in etiqueta["pasos"] if p.get("paso") in elegidos]
    lista = tramos(etiqueta, a.margen, tempfile.mkdtemp(prefix="ab_rescate_"))
    motor = crear_motor_de_evaluacion()
    base = motor._config
    # Calentamiento (no se cuenta): la primera inferencia de cada modelo carga y compila
    for cond in CONDICIONES.values():
        motor._config = dataclasses.replace(base, rescate_cuadros=cond)
        evaluar(motor, lista[0][1], a.videos, a.tope_analisis)

    filas = []   # (paso, repetición, condición, resultado)
    for rep in range(a.repeticiones):
        for k, (paso, ruta) in enumerate(lista):
            orden = ("A", "B") if (rep + k) % 2 == 0 else ("B", "A")
            for cond in orden:
                motor._config = dataclasses.replace(base, rescate_cuadros=CONDICIONES[cond])
                res = resultado_del_paso(evaluar(motor, ruta, a.videos, a.tope_analisis), paso)
                filas.append((paso.get("paso"), rep, cond, paso.get("legible", True), res))
                print(f"rep {rep} paso {paso.get('paso')} {cond}: exacta={res['exacta']} registrado={res['registrado']} "
                      f"sin_paso={res['sin_paso']} rescate={res['rescate']} fps={res['fps_analizados']} etapas={res['etapas_p50_ms']}", flush=True)
    motor.detener()

    def de(cond, legible=None):
        return [f for f in filas if f[2] == cond and (legible is None or f[3] == legible)]

    informe: dict = {"configuracion": {"repeticiones": a.repeticiones, "tope_analisis_fps": a.tope_analisis, "margen_s": a.margen,
                                       "pasos": [p.get("paso") for p, _ in lista]}}
    for cond in CONDICIONES:
        legibles, no_legibles = de(cond, True), de(cond, False)
        latencias = [f[4]["lat_registro_s"] for f in de(cond) if f[4]["lat_registro_s"] is not None]
        informe[cond] = {
            "placa_exacta": wilson(sum(f[4]["exacta"] for f in legibles), len(legibles)),
            "pasos_legibles_con_registro": wilson(sum(f[4]["registrado"] for f in legibles), len(legibles)),
            "lecturas_confirmadas_erroneas": sum(1 for f in legibles if f[4]["registrado"] and not f[4]["exacta"] and f[4]["valida"] is True),
            "pasos_no_legibles_registrados": f"{sum(f[4]['registrado'] for f in no_legibles)}/{len(no_legibles)}",
            "registros_fuera_de_los_pasos": sum(f[4]["sin_paso"] for f in de(cond)),
            "duplicados": sum(max(0, f[4]["registros"] - 1) for f in de(cond)),
            "lat_registro_s_p50": round(statistics.median(latencias), 3) if latencias else None,
            "cuadros_rescatados": sum(f[4]["rescate"].get("cuadros", 0) for f in de(cond)),
            "otras_fotos_leidas": sum(f[4]["rescate"].get("otras_fotos", 0) for f in de(cond)),
            "fps_analizados_p50": statistics.median(f[4]["fps_analizados"] for f in de(cond) if f[4]["fps_analizados"]),
        }
    # Pares (paso legible, repetición)
    pares = {}
    for numero, rep, cond, legible, res in filas:
        if legible:
            pares.setdefault((numero, rep), {})[cond] = res["exacta"]
    b = sum(1 for v in pares.values() if v.get("A") and not v.get("B"))
    c = sum(1 for v in pares.values() if v.get("B") and not v.get("A"))
    informe["mcnemar"] = {"solo_A": b, "solo_B": c, "p": round(mcnemar_exact(b, c), 4)}
    informe["por_paso"] = {
        str(numero): {cond: f"{sum(f[4]['exacta'] for f in filas if f[0] == numero and f[2] == cond)}/{a.repeticiones}"
                      for cond in CONDICIONES}
        for numero in [p.get("paso") for p, _ in lista] if any(f[0] == numero and f[3] for f in filas)
    }
    print(json.dumps(informe, ensure_ascii=False, indent=2))
    if a.salida:
        with open(a.salida, "w", encoding="utf-8") as f:
            json.dump(informe, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
