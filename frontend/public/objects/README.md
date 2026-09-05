# Fotos de objeto sobre círculo dorado

El recurso visual editorial de la web de Stellar: un objeto fotográfico recortado,
en blanco y negro de alto contraste, apoyado sobre un círculo dorado plano.

**El círculo lo pinta el componente `ObjectShot`. La imagen debe traer solo el
objeto, con fondo transparente.**

Si un archivo no existe, `ObjectShot` dibuja una versión en línea del mismo objeto,
así que la página nunca se ve rota. No hace falta subirlos para desplegar.

| Archivo | Sección | Qué representa |
|---|---|---|
| `ticket.png` | The problem | la espera, el "procesando…" |
| `telegraph.png` | How it works | transmisión instantánea a distancia |
| `stopwatch.png` | Live | los milisegundos |

Además, `../og.png` (1200×630) es la imagen que se ve al compartir el enlace.

## Prompts

Plantilla común — cambia solo la frase del objeto:

```
Editorial product photograph for a premium fintech website. A single <OBJETO>.
Photographed in high-contrast black and white, desaturated, crisp studio lighting
from the upper left, soft shadow. The object is centered, isolated and cut out on
a fully transparent background. Minimalist, no text, no logos, no people, no
background scenery. Square 1:1 composition, high resolution, PNG with alpha
transparency.
```

- `ticket.png` → `paper queue ticket stub printed with a number, slightly crumpled and torn at one edge`
- `telegraph.png` → `vintage brass telegraph key, side three-quarter view, mechanical detail visible`
- `stopwatch.png` → `antique mechanical stopwatch with its hands frozen just past zero, front view, crown at the top`

Para `og.png` (esta sí lleva fondo, y es apaisada):

```
Wide social share banner, 1200x630 pixels. Solid near-black background (#0F0F0F).
Centered in the upper half: a golden yellow (#FDDA24) lightning bolt crossing
diagonally through a thin golden ring outline, flat vector style with sharp edges.
The lower half is empty near-black space. Minimal, geometric, no gradients, no
text, no logos, no photographic elements.
```

Si el generador no da transparencia, pídelas sobre fondo blanco liso: recortar
después es trivial.
