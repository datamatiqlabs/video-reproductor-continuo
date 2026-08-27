# video-reproductor-continuo

Reproductor continuo de videos desde Google Sheets - Carga listas de reproducción en CSV

## Backend extractor (Node.js)

He agregado un pequeño backend que intenta extraer URLs directas a MP4 desde páginas externas. Esto mejora la fiabilidad frente a proxies públicos y permite establecer cabeceras y tiempos de espera.

Archivos añadidos:
- server/index.js  — API Express con endpoint `/extract?url=...` que devuelve `{ success: true, url: "...mp4" }` si encuentra un MP4.
- package.json     — dependencias y script start.

Cómo usarlo localmente:

1. Clona el repo y entra en la carpeta:

   git clone https://github.com/datamatiqlabs/video-reproductor-continuo.git
   cd video-reproductor-continuo

2. Instala dependencias:

   npm install

3. Arranca el servidor extractor:

   npm start

   El servicio escuchará por defecto en http://localhost:3000

4. Prueba el endpoint (ejemplo):

   curl "http://localhost:3000/extract?url=https://www.instagram.com/reels/Dcg7oVVti1m/"

Notas importantes:
- Algunas plataformas requieren cookies, cabeceras o autenticación para devolver un MP4. Este extractor es una ayuda, pero no garantiza extracción en todos los casos.
- Para producción considera desplegar en un servidor propio y añadir manejo de rate limits, caching y conversión HLS -> MP4 si lo necesitas.

