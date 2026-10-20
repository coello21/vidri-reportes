# Reportes CD Nejapa

Tableros de preparación del CD Nejapa (Radar de Negados y Pedidos CD) en **TypeScript + Vite**. Los datos se guardan en **Supabase** y la página se publica en **GitHub Pages**.

## Estado

| Paso | Qué | Estado |
|---|---|---|
| 1 | Cálculos en TypeScript (negados y pedidos) con pruebas contra el tablero original y contra números reales | ✅ |
| 2 | Conexión a Supabase y login sobre los módulos nuevos (`src/nube`, `src/app`, página `/app/`) | ✅ |
| 3 | Pantallas: Resumen, Top negados, Pedidos CD (solo lectura; misma apariencia, comparadas contra el Radar original) | ✅ |
| 3b | Cargar Excel, Excel por preparador y Reporte ejecutivo en la versión nueva | pendiente |
| 4 | "Descargar HTML" de 45 días como archivo independiente | pendiente |
| 5 | Reporte ejecutivo automático (botón **Reporte ejecutivo** en el Radar: pedidos y negados; productividad cuando su tablero esté en la base) | ✅ parcial |

Mientras se hacen los pasos 2–5, **el Radar actual sigue funcionando** (carpeta `public/radar/`, ya conectado a Supabase). Se publica junto con el proyecto en la misma dirección y se reemplaza cuando la versión nueva esté lista.

## Estructura

```
src/core/                Lógica sin pantalla (se puede probar)
  comun/                 Fechas, textos y números
  negados/               Rpt_OrdenesPreparacion: lectura, duplicados, resumen por día, vistas, fill rate B2B
  pedidos/               Document.xlsx: lectura, cortes, hora de asignación, balance, avance, pendientes
tests/                   Pruebas (Vitest)
  original/              Copia del código del tablero HTML original, para comparar resultados
  helpers/               Generador de reportes sintéticos con todos los casos raros
  fixtures/              Datos reales SOLO en tu computadora (*.local.*, no se suben)
src/nube/                Lectura y guardado en Supabase (solo lo que cambió)
src/app/                 Versión nueva de la página (/app/)
public/                  Lo que se publica tal cual (Radar actual, config.js, librería de Supabase)
supabase/                SQL de las tablas y la seguridad
scripts/                 Utilidades (sacar datos de prueba de un HTML del Radar)
.github/workflows/       Pruebas automáticas y publicación en GitHub Pages
```

## Pruebas

```bash
npm install
npm test            # todas las pruebas
npm run typecheck   # revisa los tipos
```

- **negados.diferencial**: genera reportes sintéticos (duplicados, reasignaciones, pendientes, celdas vacías, B2B) y compara línea por línea contra el código original del tablero.
- **pedidos.diferencial**: igual con el reporte de transferencias y la hora de asignación.
- **datos-reales**: con los datos reales de un día verifica que se obtengan los mismos números que mostraba el tablero (negados, exactitud, fill rate B2B, balance de pedidos, pendientes…). Necesita los archivos locales de datos y de números esperados; si no están, se salta.

Para crear el archivo local de datos a partir de un HTML descargado del Radar:

```bash
node scripts/fixture-desde-html.mjs "ruta/Radar_de_Negados_2026-10-19.html"
```

> Los datos de la empresa nunca se suben al repositorio: `.gitignore` excluye `tests/fixtures/*.local.*`. Si subes archivos desde la web de GitHub (arrastrando), revisa que no vaya ninguno de esa carpeta.

## Publicación

- **Supabase**: proyecto `cd-nejapa-reportes`. Tablas creadas con `supabase/01_esquema.sql`; los correos con acceso van en la tabla `app_usuarios` (`supabase/02_mi_correo.sql`).
- **`public/config.js`**: ya tiene la URL y la clave pública del proyecto. La clave pública puede ir en el código; nunca pongas aquí la clave secreta (`service_role`).
- **GitHub Pages**: en el repositorio, **Settings → Pages → Source: GitHub Actions**. Cada cambio en `main` corre las pruebas y, si pasan, publica en `https://coello21.github.io/vidri-reportes/`.
- **Inicio de sesión**: en Supabase, **Authentication → URL Configuration**, agrega `https://coello21.github.io/vidri-reportes/**` en Redirect URLs y pon `https://coello21.github.io/vidri-reportes/radar/` como Site URL.

## Uso diario (mientras tanto)

Abre `.../radar/`, entra con tu correo, carga los Excel y usa **Descargar HTML** para el correo, igual que antes. **Reporte ejecutivo** arma el PDF del día con los datos cargados (en la ventana de impresión elige «Guardar como PDF»). La primera vez usa **Importar respaldo** con tu último HTML del Radar para pasar el historial a la base.
