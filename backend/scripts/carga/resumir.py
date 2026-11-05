"""Resume en tablas una comparación de comparar.sh: python resumir.py <dir-salida> [rondas]"""
import json
import statistics as st
import sys
from pathlib import Path

D = Path(sys.argv[1])
RONDAS = int(sys.argv[2]) if len(sys.argv) > 2 else 2


def cargar(lado, prueba):
    return [json.loads((D / f"{lado}{r}_{prueba}.json").read_text(encoding="utf8")) for r in range(1, RONDAS + 1)]


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 1) if xs else None


print("## Latencia por ruta, una petición a la vez (p50 ms, por ronda)")
A, B = cargar("A", "secuencial"), cargar("B", "secuencial")
print(f"{'ruta':28} {'A1':>9} {'A2':>9} {'B1':>9} {'B2':>9} {'err A':>6} {'err B':>6}")
for k in A[0]:
    fa, fb = [x[k]["p50"] for x in A], [x[k]["p50"] for x in B]
    print(f"{k:28} " + " ".join(f"{v:>9}" for v in fa + fb) + f" {sum(x[k]['errores'] for x in A):>6} {sum(x[k]['errores'] for x in B):>6}")

print("\n## Operadores simultáneos")
A, B = cargar("A", "concurrente"), cargar("B", "concurrente")
print(f"{'nivel':16} {'rps A':>14} {'rps B':>14} {'p50 A':>18} {'p50 B':>14} {'p95 A':>18} {'p95 B':>14} {'err A':>6} {'err B':>6}")
for k in A[0]:
    fila = lambda L, c: "/".join(str(x[k][c]) for x in L)
    print(f"{k:16} {fila(A,'rps'):>14} {fila(B,'rps'):>14} {fila(A,'p50'):>18} {fila(B,'p50'):>14} {fila(A,'p95'):>18} {fila(B,'p95'):>14} "
          f"{sum(x[k]['errores'] for x in A):>6} {sum(x[k]['errores'] for x in B):>6}")

print("\n## 30 inicios de sesión simultáneos")
for lado in "AB":
    for r, x in enumerate(cargar(lado, "login"), 1):
        total = max(y["ms"] for y in x["resultados"])
        print(f"{lado}{r}: total {total} ms · estados {sorted({y['estado'] for y in x['resultados']})} · "
              f"/health p50 {x['health']['p50']} p95 {x['health']['p95']} max {x['health']['max']} ms (n={x['health']['n']})")
