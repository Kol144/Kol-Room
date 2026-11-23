# Kol Room · Drummer Edition

[Abrir Kol Room desde el móvil](https://kol144.github.io/Kol-Room/)

Esta copia independiente se guarda en la carpeta `Kol room` y se publica en `Kol144/Kol-Room`.

Los BPM se muestran y guardan como enteros. Al importar con conexión se consulta ReccoBeats y, si hace falta, MusicBrainz y AcousticBrainz. Una grabación identificada por sus etiquetas o por título, artista y duración puede fijar el tempo del metrónomo. El editor muestra la fuente, permite volver a buscar y respeta los ajustes manuales. Si la búsqueda queda sin resultado, se conserva el tempo local.

Con la cuenta activada, Kol Room prepara la posición del audio mientras suenan cuatro pulsos para que el primer golpe entre en el quinto. Usa el primer pulso marcado o detectado y, en su ausencia, el primer sonido. Al desactivar la cuenta se escucha el archivo desde el principio y el clic espera al primer sonido. La reproducción usa el intervalo medido en segundos.

Durante la importación también se sintetiza el anuncio neuronal y se guarda en el dispositivo para futuros ensayos, incluso sin conexión. Cambiar el título, la pronunciación, el modelo o la velocidad de voz da lugar a una locución distinta. La pausa entre el título y la cuenta se puede ajustar en **Ajustes → Voz y anuncios**.

Los anuncios pueden usar DaveFX en español o Lessac en inglés. La selección automática reconoce vocabulario frecuente del título. Para nombres propios o resultados ambiguos, el editor permite fijar el idioma y escribir una pronunciación específica. El modelo inglés se descarga en su primer uso y después se conserva en la caché de la web.

Aplicación de ensayo para batería. Reproduce los archivos del dispositivo en el orden del repertorio. La edición mantiene Vite, JavaScript, la navegación en tres vistas, los proyectos originales y la aplicación Android de Capacitor.

## Abrir en local

Con Node.js 22.12 o posterior, ejecuta estos comandos en la carpeta del proyecto. Para seguir usando los mismos proyectos, vuelve a abrir la misma dirección en el mismo perfil del navegador.

```sh
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Abre [Kol Room en este equipo](http://127.0.0.1:4173/). Tras la primera carga de producción, el service worker guarda la interfaz y los módulos que permiten importar y analizar archivos sin red. Para editar código usa `npm run dev`. La dirección de desarrollo y la web de GitHub Pages tienen almacenes independientes.

## Preparar un ensayo

1. En **Repertorio**, selecciona o crea el proyecto de la banda. **Importar audio** admite varios archivos. **Añadir canción** permite preparar el orden antes de tener la grabación.
2. En **Editar**, revisa título, artista, portada, tempo y tonalidad. Puedes escoger la sugerencia o corregirla. Una corrección manual, incluida una tonalidad vacía, se conserva tras volver a analizar. Las flechas cambian la posición. **Exportar audio original** descarga los bytes importados. Si hubo conversión aparece también la copia WAV.
3. En **Ajustes**, elige voz, cuenta de entrada, clic, volúmenes, descanso y preparación. El valor explícito de una canción prevalece sobre el general. Para una preparación mixta, deja la opción general en automática y marca **Esperar confirmación** en las canciones que lo necesiten.
4. Pulsa **Reproducir repertorio**. La sesión fija el orden al empezar y omite las filas sin audio. Si una pista falla, puedes reintentarla u omitirla. La preparación manual espera a **Estamos listos**. Tras el anuncio hay una pausa de tres segundos, ajustable de 0 a 15 s en **Voz y anuncios**. Después suenan cuatro pulsos y la música empieza en el siguiente. La pausa conserva la posición o el descanso restante. Continuar una cuenta interrumpida vuelve a dar los cuatro pulsos completos.
5. En el descanso puedes añadir diez segundos, pausar o saltar. **Modo directo** amplía los controles de escenario. El repertorio finaliza con el número de canciones terminadas. La repetición requiere activación expresa.
6. Para practicar, pulsa **▶** en una fila. Abre **Práctica · velocidad y bucle A–B**, elige entre 75 y 125 % y compara el mismo pasaje al tempo original y al propuesto. Al terminar se recupera la posición de partida. **Aplicar velocidad** guarda el cambio. Marca A y B desde la barra o introduce segundos. Cero repeticiones mantiene el bucle hasta detenerlo. Los fragmentos con nombre quedan en la canción.
7. En **Mezcla y metrónomo**, sitúa la barra en el primer golpe musical y pulsa **Marcar primer pulso aquí**. El clic durante el tema y la entrada usan el BPM ajustado por la velocidad. Para practicar sin canción, la pestaña **Metrónomo** conserva el tempo de cada proyecto y permite calcularlo tocando al ritmo.

## Datos y copias

En móvil, **Editar → Usar este tempo en el metrónomo** copia el BPM de la canción al proyecto. Para ensayar la canción al tempo del proyecto, abre el reproductor, entra en **Práctica → Ajustar al metrónomo** y pulsa **Aplicar velocidad**. El intervalo disponible es del 75 al 125 % del tempo original.

Si falta la carátula, la búsqueda en segundo plano usa los metadatos textuales en MusicBrainz y descarga una miniatura de Cover Art Archive. También reconoce nombres del tipo «Artista - Título». La imagen queda disponible sin conexión. Puedes desactivar la consulta en **Ajustes → Almacenamiento local**.

El análisis compara los ataques en varios pasajes con sus tiempos reales para estimar tanto el BPM como el desfase del clic. En grabaciones con tempo variable, la cuadrícula representa un tempo global. Usa **Volver a analizar** para actualizar canciones ya importadas.

El detector revisa hasta el primer minuto para localizar el comienzo de una secuencia de golpes coherente con ese tempo. El botón ancho del reproductor activa o desactiva el clic durante la canción y conserva la elección para esa pista.

En **Salidas de audio**, autoriza los dispositivos para que aparezcan en los selectores y utiliza **Probar salida de música** o **Probar salida del clic**. Cuando el navegador pide permiso de micrófono para enumerar dispositivos, se cierra la captura inmediatamente después de obtenerlo. En móviles donde el navegador delega la salida al sistema, selecciona altavoz, Bluetooth o auriculares en los controles del teléfono. El estéreo dividido envía música y clic por los canales izquierdo y derecho de una interfaz estéreo.

La base `pulso_sampler_v1` se actualiza de v1 a v2 en una transacción. Conserva el almacén `projects`, identificadores, orden, letras heredadas, BPM, tonalidad y colores. Incorpora `audioFiles` y `coverImages`. Cada importación confirma en conjunto sus archivos, portada y referencia desde la canción. Un error o una cancelación antes de la escritura conserva la versión anterior. Los audios permanecen en el dispositivo. Una voz remota puede enviar el texto del anuncio al proveedor de voz del sistema.

**Gestionar → Exportar repertorio (.pulso)** guarda los datos de las canciones y sus opciones. Para trasladar el proyecto a otro equipo, conserva también los audios y las imágenes personalizadas. Al abrir un .pulso en el mismo perfil se recuperan los archivos que aún existan allí. En otro dispositivo puedes volver a asociarlos desde el editor. Las opciones generales se guardan en el perfil. Borrar los datos del navegador o desinstalar la aplicación puede eliminar el repertorio local.

**Ajustes → Almacenamiento local** muestra el uso, la cuota estimada y la persistencia que informa el navegador. La limpieza solicita confirmación y comprueba las referencias de todos los proyectos. Quitar una pista hace posible recuperar su espacio posteriormente.

## Audio, análisis y compatibilidad

- La importación verifica que el elemento de audio llegue a estar listo. Si necesita conversión, se puede guardar una copia PCM WAV local cuando el decodificador del dispositivo admite la fuente. También se convierte AIFF clásico PCM mono/estéreo de 8, 16, 24 o 32 bits a frecuencia entera. Se conserva siempre el original de cada importación aceptada. WMA y variantes comprimidas de AIFF dependen de los códecs disponibles. Se prescindió de FFmpeg.wasm para evitar la descarga del motor y sus copias de memoria en móviles.
- Las etiquetas y las carátulas se leen localmente con `music-metadata`. Las portadas se recortan a cuadrado y se limitan a 640 píxeles por lado. El editor permite cargar otra y restaurar la incrustada.
- La estimación de BPM usa flujo espectral de ataques y autocorrelación. El análisis tonal compara un cromagrama con perfiles mayores y menores de Krumhansl–Kessler. La puntuación de confianza indica la fuerza relativa de la estimación, sin calibración probabilística. Una mezcla con poco pulso o sin armonía reconocible puede quedar sin resultado. Referencia sobre el cálculo de tempo mediante autocorrelación de ataques. [Ellis, *Beat Tracking by Dynamic Programming*](https://labrosa.ee.columbia.edu/~dpwe/pubs/Ellis06-beattrack.pdf)
- La aplicación reproduce desde blobs sin mantener todas las canciones decodificadas. Para el análisis se decodifica una canción a 11.025 Hz y se muestrean hasta tres pasajes de 18 segundos. Se omite el análisis por encima de 64 MiB o 12 minutos. La decodificación inicial y la conversión pueden consumir memoria en teléfonos. Las operaciones entre archivos son secuenciales. Las pruebas de tamaño y duración limitan las conversiones grandes.
- La selección automática en español utiliza DaveFX, una voz neuronal de Piper integrada en Kol Room. El navegador carga el motor y el modelo al primer anuncio o al pulsar **Escuchar voz** (aproximadamente 93 MB). La inferencia ocurre en un worker local. En la web de producción la caché permite repetir la síntesis sin conexión después del primer uso. También se pueden elegir las voces del sistema. [Ficha de DaveFX](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/es/es_ES/davefx/medium/MODEL_CARD) El selector identifica las que pueden necesitar conexión. Los sistemas sin síntesis utilizable muestran el título. Si el motor sigue indicando que habla después de un fallo, la aplicación espera confirmación. El idioma y el género disponibles dependen de las voces instaladas.
- Los clics se programan con el reloj de Web Audio. El audio musical usa un elemento multimedia para permitir reproducción larga y cambio de velocidad con conservación de tono cuando el navegador lo admite. La latencia de salida, Bluetooth y los cambios de tempo de la propia grabación pueden desplazar el clic. Se admite un BPM global con desfase por canción. Los cortes A–B tienen la precisión de búsqueda del decodificador.
- Las salidas físicas por separado requieren soporte de `AudioContext.setSinkId`, permisos y dispositivos disponibles. El estéreo dividido envía música al canal izquierdo y clics al derecho en equipos compatibles. Requiere el cableado estéreo adecuado. La voz usa la salida del sistema. El bloqueo opcional de pantalla depende de Screen Wake Lock. Al ocultar o suspender la aplicación se pausa la sesión y el músico la reanuda expresamente.

## Pruebas

```sh
npm test
npm run build
npx cap sync android
```

Las pruebas de Node cubren migración, normalización, referencias compartidas, limpieza, estimaciones, corrección manual, cola, estados, cancelaciones, cuatro clics, velocidad, desfase, descanso y A–B.

Las siguientes comprobaciones adicionales utilizan Playwright y su Chromium. El ensayo de formatos necesita también el ejecutable FFmpeg. Estas herramientas son exclusivas del entorno de pruebas. Para `browser-app.mjs`, arranca antes la compilación de producción en el puerto 4173. Puedes indicar otra dirección con `FRUMOS_URL`.

```sh
node checks/browser-playback.mjs
node tests/media-browser.mjs
node checks/browser-app.mjs
node checks/browser-voice.mjs
```

El primer ensayo genera ondas y mide la separación de cuatro clics renderizados en PCM. El segundo genera archivos musicales sintéticos, incrusta una portada, importa, migra una base v1 real y reabre los datos. El tercero maneja la interfaz con un perfil aislado, importa tres canciones, exporta, reordena y reproduce el repertorio sin conexión. Las capturas de escritorio y móvil se guardan en la carpeta temporal del sistema.

### Resultados de esta entrega local

| Comprobación | Resultado observado |
| --- | --- |
| Node y Vite | 29 pruebas aprobadas, 0 fallos. Compilación de producción completada. |
| Archivos en Chromium 159 | Importados MP3, WAV, FLAC, OGG Vorbis, Opus, WebM Opus, M4A, AAC y AIFF PCM. El AIFF se convirtió a WAV y conservó su original. La señal de 120 BPM produjo una estimación de 120,1 BPM. |
| Persistencia | Se reabrieron los nueve archivos, la portada incrustada y la canción heredada de una base v1. El archivo dañado se rechazó sin alterar el espacio ocupado. |
| Ensayo y práctica | Repertorio de tres audios en orden, omisión de una fila sin audio, pausa y salto del descanso, modo directo, vista previa y bucle A–B. La prueba de dos canales midió cuatro pulsos separados por 400 ms, con el clic en el canal derecho. |
| Voz | La API del navegador de prueba notificó el final de la locución. DaveFX generó una muestra de audio en Chromium y otra tras recargar sin conexión. La escucha en altavoces y la elección de un timbre concreto quedan pendientes de una prueba en dispositivo. |
| Offline e interfaz | Recarga, recuperación de ajustes y portada, y reproducción con la red desactivada. Probado tanto en la raíz como bajo `/frumos/`. Revisadas vistas de 1120 y 390 píxeles. |
| Android | Capacitor sincronizó los recursos de producción. El equipo carece de Java configurado y Gradle se detuvo antes de compilar el APK. Quedan pendientes las pruebas en un Android físico, incluida la exportación con el selector de documentos. |

## Android y GitHub Pages

Se conservan el identificador Android `com.frumos.space` y el directorio web `dist`. La edición elimina el permiso de grabación y usa el selector de documentos de Android para exportar. La aplicación escribe la descarga en fragmentos. El APK requiere JDK 21 y Android SDK 36. Tras instalar ambos y configurar `JAVA_HOME` y el SDK, ejecuta `npm run android:build` en Windows. Para instalar sobre una versión existente y mantener su almacén, usa el mismo identificador y la misma firma.

Los workflows de Pages y Android ejecutan las pruebas antes de compilar. Pages usa la base relativa de Vite para funcionar bajo `/frumos/`. Un cambio local no publica una versión ni sustituye el APK disponible en GitHub.

## Archivos de esta edición

| Área | Archivos |
| --- | --- |
| Navegación, repertorio y editor | `index.html`, `app.css`, `app.js`, `song-editor.js` |
| Proyectos, migración y archivos | `project-data.js`, `storage.js` |
| Lectura, carátulas, conversión y análisis | `media.js`, `media.worker.js`, `analysis.js` |
| Motor, voz y metrónomo | `playback.js`, `audio-output.js` |
| Reproductor y ajustes | `player-ui.js`, `player-ui.css`, `settings-ui.js` |
| Offline, identidad y compilación | `public/sw.js`, `public/manifest.webmanifest`, `public/icons/`, `resources/icon.png`, `vite.config.js`, `package.json`, `package-lock.json` |
| Android | `android-export.js`, `MainActivity.java`, `DocumentExportPlugin.java`, manifiesto, recursos de lanzamiento y workflow Android |
| Verificaciones | `library.test.js`, `playback.test.js`, `checks/`, `tests/media-browser.mjs` |

Se retiraron `tuner.js` y `tuner.test.js`. La portada predeterminada `public/icons/drum-cover.webp` se generó con la herramienta de imágenes integrada a partir de una fotografía editorial cenital de caja, baquetas cruzadas y plato, con fondo de estudio oscuro y un reflejo verde lima. El icono de lanzamiento reutiliza la onda de Kol Room.

<details><summary>Descripción utilizada para generar la portada</summary>

Square monochrome editorial photograph for a drummer's setlist cover. Tight overhead crop of a real well-used acoustic snare drum with two crossed wooden drumsticks, partial hammered cymbal and another drum toward the upper right on a very dark studio floor. Crisp tactile drumhead, chrome hardware, dramatic directional light, warm silver with a restrained acid-lime glint. Analog record sleeve photography, deep blacks. No text, lettering, logos, people, graphics or border.

</details>
