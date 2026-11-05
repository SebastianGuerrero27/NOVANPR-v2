#!/usr/bin/env python3
"""
Mide el motor ANPR con varias cámaras simuladas (docker-compose.multicamara.yml): base nueva por corrida,
N cámaras que repiten el mismo video en fase (el peor caso: todas ven vehículos a la vez) y, durante
`--segundos`, CPU y memoria del motor. El resultado no contiene placas: solo cuántas se leyeron bien.

    source backend/scripts/carga/entorno.sh
    export VIDEO_CLIP=C:/ruta/clip.mp4
    python backend/scripts/carga/multicamara.py --camaras 4 --verdad placas.txt --roi zona.json --salida r.json

--verdad    una placa por línea: las que aparecen en el video (en tiempo de ejecución; no se versiona)
--pasos     placas que pasan en cada vuelta del video × vueltas = lecturas esperadas por cámara
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import time
from collections import Counter

BANCO = os.path.dirname(os.path.abspath(__file__))
COMPOSE = ["docker", "compose", "-p", "anpr-multicamara", "-f", os.path.join(BANCO, "docker-compose.multicamara.yml"), "--profile", "varios-motores"]


def sh(*args: str, entrada: str | None = None, verificar: bool = True) -> str:
    r = subprocess.run(args, input=entrada, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    if verificar and r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)[:120]}: {r.stderr[-800:]}")
    return r.stdout


def psql(sql: str) -> str:
    return sh(*COMPOSE, "exec", "-T", "db", "psql", "-U", "anpr", "-d", "ANPR_ECU911", "-qAt", "-F", "\t", "-c", sql)


def esperar(condicion, tope: float, que: str, cada: float = 2.0):
    limite = time.time() + tope
    while time.time() < limite:
        try:
            valor = condicion()
            if valor:
                return valor
        except Exception:
            pass
        time.sleep(cada)
    raise TimeoutError(f"Sin {que} tras {tope:.0f} s")


def estado_motor(servicio: str = "anpr") -> dict:
    salida = sh(*COMPOSE, "exec", "-T", servicio, "python", "-c",
                "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/status',timeout=4).read().decode())")
    return json.loads(salida)


def camaras_con_video(estado: dict) -> int:
    if "camaras" in estado:  # versión multicámara
        return sum(1 for c in estado["camaras"] if c.get("conectada") and c.get("capture_fps", 0) >= 5)
    return 1 if estado.get("capture_fps", 0) >= 5 else 0  # versión anterior: una sola


def por_camara(estado: dict) -> list[dict]:
    if "camaras" in estado:
        return estado["camaras"]
    return [{"id": None, "capture_fps": estado.get("capture_fps"), "tracker_fps": estado.get("tracker_fps"),
             "latencia": estado.get("latencia"), "inferencias_omitidas_pct": estado.get("inferencias_omitidas_pct")}]


def contenedor(servicio: str) -> str:
    return sh(*COMPOSE, "ps", "-q", servicio).strip()


def muestra_docker(cid: str) -> tuple[float, float]:
    """CPU en núcleos y memoria en MiB."""
    fila = sh("docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", cid).strip()
    cpu, mem = fila.split("|")
    usado = mem.split("/")[0].strip()
    factor = {"GiB": 1024.0, "MiB": 1.0, "KiB": 1 / 1024}[usado[-3:]]
    return float(cpu.rstrip("%")) / 100.0, float(usado[:-3]) * factor


def percentil(valores: list[float], p: float) -> float | None:
    if not valores:
        return None
    orden = sorted(valores)
    return orden[min(len(orden) - 1, int(round(p / 100 * (len(orden) - 1))))]


def main() -> None:
    a = argparse.ArgumentParser()
    a.add_argument("--camaras", type=int, required=True)
    a.add_argument("--motores", type=int, default=1, help="procesos de motor; las cámaras se reparten entre ellos")
    a.add_argument("--registros", help="archivo donde guardar el registro del motor (contiene placas: fuera del repositorio)")
    a.add_argument("--segundos", type=int, default=360)
    a.add_argument("--verdad", required=True)
    a.add_argument("--roi", required=True)
    a.add_argument("--esperadas", type=int, default=10, help="lecturas esperadas por cámara en la corrida")
    a.add_argument("--etiqueta", default="")
    a.add_argument("--salida", required=True)
    args = a.parse_args()

    verdad = {x.strip().replace("-", "").upper() for x in open(args.verdad, encoding="utf-8") if x.strip()}
    roi = json.load(open(args.roi, encoding="utf-8"))
    motores = ["anpr"] + [f"anpr{i}" for i in range(2, args.motores + 1)]
    os.environ["MOTORES"] = ",".join(f"http://{m}:8000" for m in motores)
    os.environ["MOTORES_PUBLICOS"] = ",".join(f"http://localhost:{18000 + i}" for i in range(args.motores))
    os.environ["ANPR_MAX_CAMARAS"] = str(-(-args.camaras // args.motores))

    sh(*COMPOSE, "down", "-v", "--remove-orphans", verificar=False)
    sh(*COMPOSE, "up", "-d", "db", "camaras", "backend", "mediamtx")
    esperar(lambda: "healthy" in sh("docker", "inspect", "-f", "{{.State.Health.Status}}", contenedor("backend")), 180, "backend sano")
    valores = ",".join(
        f"('Camara {i}','10.0.0.{i}','rtsp://camaras:8554/cam{i}','Banco de pruebas','ingreso','{json.dumps(roi)}',TRUE,'SIN_VERIFICAR')"
        for i in range(1, args.camaras + 1))
    psql(f"INSERT INTO camaras (nombre, ip, rtsp_url, ubicacion, direccion, roi, activa, estado) VALUES {valores};")
    sh(*COMPOSE, "up", "-d", "--no-deps", *motores)
    cids = [contenedor(m) for m in motores]

    def estados() -> list[dict]:
        return [estado_motor(m) for m in motores]

    def con_video() -> int:
        return sum(camaras_con_video(e) for e in estados())

    # El backend reparte las cámaras en cuanto los motores responden y el video tarda en llegar
    esperar(lambda: con_video() >= args.camaras, 420, f"{args.camaras} cámaras con video", 5.0)
    time.sleep(10)  # modelos de fondo (MOG2) asentados
    psql("TRUNCATE deteccionvehiculo CASCADE;")
    inicio = time.time()

    cpu: list[float] = []
    memoria: list[float] = []
    tasas_analisis: list[float] = []
    while time.time() - inicio < args.segundos:
        muestras = [muestra_docker(c) for c in cids]
        cpu.append(sum(x[0] for x in muestras))
        memoria.append(sum(x[1] for x in muestras))
        for e in estados():
            tasas_analisis.extend(x.get("tracker_fps") or 0.0 for x in por_camara(e))
        time.sleep(8)
    time.sleep(12)  # registros y reevaluaciones en curso

    filas = psql("SELECT camara_id, COALESCE(placa_validada, placa_reconocida, ''), COALESCE(lectura_valida::text, ''), estado_procesamiento "
                 "FROM deteccionvehiculo WHERE tipo_movimiento = 'ingreso';").splitlines()
    filas = [f.split("\t") for f in filas]
    final = [c for e in estados() for c in por_camara(e)]
    detalle = []
    exactas_total = 0
    for camara in sorted({f[0] for f in filas} | {str(c.get("id")) for c in final if c.get("id") is not None}):
        suyas = [f for f in filas if f[0] == camara]
        placas = Counter(f[1].replace("-", "").upper() for f in suyas if f[1])
        exactas = sum(n for p, n in placas.items() if p in verdad)
        exactas_total += exactas
        erroneas = sum(n for p, n in placas.items() if p not in verdad)
        confirmadas_mal = sum(1 for f in suyas if f[1] and f[1].replace("-", "").upper() not in verdad and f[2] == "true")
        confirmadas = sum(1 for f in suyas if f[1] and f[2] == "true")
        # La versión anterior no identifica la cámara en su estado: tiene una sola
        c = next((x for x in final if str(x.get("id")) == camara or x.get("id") is None), {})
        latencia = c.get("latencia") or {}
        detalle.append({
            "camara": camara, "registros": len(suyas), "exactas": exactas, "erroneas": erroneas, "sin_lectura": sum(1 for f in suyas if not f[1]),
            "confirmadas": confirmadas, "confirmadas_erroneas": confirmadas_mal,
            "fps_captura": c.get("capture_fps"), "fps_analisis": c.get("tracker_fps"),
            "registro_p50_ms": (latencia.get("registro") or {}).get("p50_ms"), "registro_p95_ms": (latencia.get("registro") or {}).get("p95_ms"),
            "edad_cuadro_p50_ms": (latencia.get("edad_cuadro") or {}).get("p50_ms"), "edad_cuadro_p95_ms": (latencia.get("edad_cuadro") or {}).get("p95_ms"),
            "lectura_vivo_p50_ms": (latencia.get("lectura_en_vivo") or {}).get("p50_ms"),
            "omitidas_pct": c.get("inferencias_omitidas_pct"),
        })
    resultado = {
        "etiqueta": args.etiqueta, "camaras": args.camaras, "motores": args.motores, "segundos": args.segundos,
        "intervalo_gil_ms": os.environ.get("ANPR_INTERVALO_GIL_MS", "0.5"), "hilos_opencv": os.environ.get("ANPR_HILOS_OPENCV", "2"),
        "imagen_motor": os.environ.get("IMAGEN_MOTOR", "anpr-motor:produccion"), "detectores": os.environ.get("ANPR_DETECTORES", "1"),
        "esperadas": args.esperadas * args.camaras, "exactas": exactas_total,
        "exactitud_pct": round(100 * exactas_total / (args.esperadas * args.camaras), 1),
        "cpu_nucleos": {"media": round(statistics.mean(cpu), 2), "p95": round(percentil(cpu, 95) or 0, 2), "max": round(max(cpu), 2)},
        "memoria_mib": {"media": round(statistics.mean(memoria)), "max": round(max(memoria))},
        "fps_analisis_medio": round(statistics.mean(tasas_analisis), 1) if tasas_analisis else None,
        "reinicios_motor": sum(int(sh("docker", "inspect", "-f", "{{.RestartCount}}", c).strip()) for c in cids),
        "detalle": detalle,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.salida)), exist_ok=True)
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in resultado.items() if k != "detalle"}, ensure_ascii=False), flush=True)
    if args.registros:
        with open(args.registros, "w", encoding="utf-8") as f:
            for c in cids:
                f.write(sh("docker", "logs", c, verificar=False))
    sh(*COMPOSE, "down", "-v", "--remove-orphans", verificar=False)


if __name__ == "__main__":
    main()
