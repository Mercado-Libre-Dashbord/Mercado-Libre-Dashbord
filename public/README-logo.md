# Logo

El sidebar busca el logo en esta carpeta, probando en orden:
`logo.png` → `logo.svg` → `logo.webp` → `logo.jpg`.
Si no encuentra ninguno, cae en el monograma original: no se rompe nada.

## Cómo subirlo desde el navegador (no hace falta instalar nada)

1. Entrar a https://github.com/Mercado-Libre-Dashbord/Mercado-Libre-Dashbord
2. Click en la carpeta `public`.
3. Botón **Add file** (arriba a la derecha) → **Upload files**.
4. Arrastrar el archivo del logo.
5. **Importante**: el archivo tiene que llamarse `logo` + su extensión
   (`logo.png`, `logo.svg`, `logo.webp` o `logo.jpg`). Si se llama distinto,
   renombrarlo en la compu antes de arrastrarlo.
6. Abajo, dejar seleccionado *Commit directly to the `main` branch* y click en
   **Commit changes**.

Vercel redeploya solo en 1–2 minutos y el logo aparece en el sidebar.

## Formato recomendado

Cuadrado, fondo transparente, 256×256 px (PNG o SVG). Se muestra a 32×32 con
`object-fit: contain`, así que un logo rectangular también entra, solo que más
chico.
