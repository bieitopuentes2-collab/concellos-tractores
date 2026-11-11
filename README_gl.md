# Concellos Bieito · v3.1 (seguimento + control)

App web estática (GitHub Pages) para o seguimento e o **control administrativo** dos tractores cedidos pola Xunta aos concellos (Convenio Biomasa 2026-2029). Datos en Supabase (táboa `seaga_records`). O traballo de campo segue facéndose con Google Earth + KML; o destino final é a GDB de ArcGIS Pro (a app non toca a GDB).

## Cambios da v3.1 (11/11/2026) · acta con dúas marcas

- No grupo **Acta** hai dúas marcas (ticks) en vez de texto: **Acta enviada** (clave nova `actaEnviada`) e **Acta recibida / asinada** (`actaAsinada`). Gardan «Si» / «Non» en `change`. Ao marcar ou desmarcar «asinada» actualízase tamén `firmada` co mesmo valor. Se unha marca nunca se tocou non se crea a clave.
- Vense na vista de lectura (✓ Si / — Non), na cabeceira da ficha (✉ enviada · ✍ asinada), na lista (iconas ✉ ✍ cando están marcadas) e no resumo (número de actas enviadas e asinadas). A exportación CSV/Excel inclúe a columna `actaEnviada`.
- Os textos de orixe (`acta`, `firmada`, `asinadaPor`) seguen visibles só para lectura no grupo Acta.
- Caché do service worker: `cb-shell-2026-11-11-v3-1`.

## Cambios da v3 (11/11/2026) · deseño e forma de introducir datos

- **Deseño**: contido centrado (máx. 1680 px) e cabeceira aliñada; escalas comúns de letra, espazos, raios, sombras e cores (variables CSS); botóns, campos e tarxetas homoxéneos; zonas táctiles de 40 px ou máis.
- **Barra lateral**: o resumo de control vai primeiro (km preparados / feitos / non feitos destacados e caixas por estado cun punto de cor; un clic filtra e a caixa activa queda marcada). O resumo de seguimento queda nun bloque despregable. Os filtros quedan fixos ao desprazar a lista.
- **Lista**: nome en grosa, provincia e tractores en gris, distintivo de estado coa súa cor e km preparados / feitos cando os hai.
- **Separador «Control»**:
  - Por defecto amósase unha **vista de lectura** en tarxetas: Estado, Preparación do KMZ, Resultado de campo (con barra de % feito) e Acta.
  - O botón **«Editar datos»** abre o formulario agrupado (Estado · Preparación do KMZ · Resultado de campo · Acta · Notas en texto completo), en 2 columnas no PC e 1 no móbil, coas unidades (km, tramos) á beira do número.
  - Barra fixa **Cancelar / Gardar** co indicador «Cambios sen gardar». Avisos de validación: números negativos, seguros + aproximados > tramos, km feitos + non feitos > km preparados, estado sen datos.
- **Notas con data** (campo e visitas; chamadas e correos): cada unha ten un formulario «Engadir nota» con **data** (hoxe por defecto, non se admiten datas futuras), **anotación** e, nas chamadas, **tipo** opcional (Chamada / Correo). As notas amósanse como liña de tempo, da máis nova á máis antiga. O texto antigo sen data aparece ao final como «Sen data · rexistro anterior».
  - **Compatibilidade**: segue gardándose nas mesmas claves de texto `notaCampo` e `notaChamadas`. Cada nota nova engádese ao principio como unha liña `DD/MM/AAAA · texto` (ou `DD/MM/AAAA · Chamada: texto`). Gárdase ao momento, coa mesma comprobación de `updated_at`.
  - Nas notas de campo hai a opción «Rexistrar tamén no historial de visitas», que engade unha visita (`visits[]`, con `fecha` e `observacions`) igual ca o botón «+ Visita».
- Non cambia ningunha clave de datos, nin o acceso, a sincronización, a exportación CSV/Excel, as fichas ocultas ou `MOSTRAR_DOCUMENTOS=false`. A caché do service worker pasa a `cb-shell-2026-11-11-v3`.

## Que cambia na v2

1. **Separador novo «Control»** (é o primeiro da ficha). Campos editables:
   estado xeral · data de preparación do KML/KMZ · ficheiro KML/KMZ · tramos · km preparados · tramos seguros · tramos aproximados · Excel que acompaña ao KML (Si/Non) · km feitos · km non feitos · acta asinada (Si/Non) · **nota de control de campo** (visitas) · **nota de control de chamadas e correos**.
   - Sen instrucións por concello: o PDF do código de cores é común para todos. A acta só leva Si/Non (sen data).
   - Gárdanse dentro de `change` (merge) con **«Gardar»**, coa mesma comprobación de `updated_at` ca antes: se outro dispositivo cambiou a ficha, avisa e non sobrescribe.
   - Só se gardan os campos que cambiaches (non se crean claves baleiras).
   - Os datos de orixe da acta (`acta`, `firmada`, `asinadaPor`) non se tocan; vense como referencia.
2. **Estado xeral** (`estadoXeral`): **Sen tractor** · Sen info · Info non localizable · KMZ preparado · En campo · Campo pechado · Cargado na GDB.
   - Filtro novo na lista («Estado xeral: …», inclúe «Sen definir»).
   - O mapa pódese colorear por **Seguimento** (o de sempre) ou por **Estado xeral**: botón ▦ do mapa → «Colorear concellos por».
3. **Resumo**: concellos por estado xeral (un clic nunha caixa filtra a lista) e km totais preparados, feitos e non feitos.
4. **Exportación**: botón **CSV** novo (exporta a lista filtrada, separador «;», abre ben en Excel). O Excel inclúe agora as columnas de control.
5. **Fotos e documentos ocultos**: sen separador «Documentación», sen botóns Foto/Documento e sen subida de arquivos en «Traballos». Non se borrou nada: código, táboa `concellos_files` e bucket seguen aí. Para volver activalos: en `app.js`, `const MOSTRAR_DOCUMENTOS=true;`.
6. **Iconas arranxadas**: `index.html`, `manifest.webmanifest` e `sw.js` apuntaban a `icons/…`, pero as iconas están na raíz do repositorio. Agora apuntan á raíz, así que vese o logo e a app pódese instalar no móbil. A versión da caché pasa a `cb-shell-2026-11-11-v2-1`.

7. **Fichas ocultas / fusionadas**: unha ficha con `change.oculto = true` non se amosa nin se conta (lista, mapa, resumo, exportacións). Non se borra: `change.fusionadoEn` indica en que ficha se integrou.
   - Caso aplicado: «OURENSE|A PEROXA (manco. Sta Águeda)» fusionada en «OURENSE|A PEROXA» (11/11/2026). A máquina Valtra G135 (28/08/2024–26/06/2026) pasou a A Peroxa sen matrícula, cunha nota explicativa. O tractor activo da mancomunidade segue na súa ficha (MANC INTERMUN SANTA ÁGUEDA - VILAMARIN).
   - Para desfacer: en Supabase, quitar `oculto` e `fusionadoEn` do `change` desa ficha.

## Que se mantén igual

Inicio de sesión (URL + clave pública + correo/contrasinal, comprobación en `seaga_members`), sincronización cada 15 s, contactos e historial, maquinaria, visitas, actuacións («Traballos»), historial de cambios (auditoría), mapa e fondos IGN/OSM, GPS, PWA. **Non se renomeou ningunha clave existente** (`acta`, `firmada`, `asinadaPor`, `notaSeaga`, `estadoVisita`, `estadoMecanico`…). A versión anterior da app segue funcionando cos mesmos datos (ignora as claves novas).

**Casos especiais codificados** (Crecente só apero, Negreira «tractor non localizado» forzado, Aranga sen visitas = fotos, Poio 2 tractores): mantéñense e están documentados no código. Só afectan á cor de seguimento e ao reconto de tractores, non ao estado xeral. Quitalos require pasar eses estados a datos; queda pendente de decidir.

## Como publicar (GitHub web, rama `main`)

1. Abre https://github.com/bieitopuentes2-collab/concellos-tractores → **Add file → Upload files**.
2. Arrastra **estes ficheiros** e substitúe os que xa están: `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`. As iconas e `galicia.json` non cambian, non fai falta subilos. Este `README_gl.md` é opcional.
3. **Commit changes** en `main`. Espera 1-2 minutos.
4. Abre https://bieitopuentes2-collab.github.io/concellos-tractores/ e pulsa **Ctrl+Shift+R** (no móbil aparecerá «Hai unha versión nova» → Actualizar).
5. **Non subas nunca** Excel, JSON de copia, informes do importador nin claves secretas: o repositorio é público.

Volver atrás: en GitHub, abre o commit anterior e restaura os catro ficheiros (ou volve subir os da versión anterior).

## Importador do Excel (`importar_rexistro.py`)

Le `_REXISTRO_ENVIOS_CONCELLOS.xlsx` (follas Concellos, Campo e Envios) e engade as claves de control en `change`. **Nunca toca `record` nin pisa claves con valor.** Comeza sempre con `DRY_RUN = True`.

```bash
pip install openpyxl requests
# 1) Proba sen escribir, cunha copia JSON da táboa:
python3 importar_rexistro.py --excel _REXISTRO_ENVIOS_CONCELLOS.xlsx --datos-json seaga_records_20261111.json
# 2) Proba con 2-3 fichas lendo en directo (variables SUPABASE_URL, SUPABASE_KEY pública, SUPABASE_EMAIL, SUPABASE_PASSWORD):
python3 importar_rexistro.py --excel _REXISTRO_ENVIOS_CONCELLOS.xlsx --limite 3
# 3) Escribir: poñer DRY_RUN = False no ficheiro e lanzar con --escribir (primeiro --limite 3, revisar na app, despois todo)
# 4) Alternativa sen contrasinal: xerar SQL (--sql update.sql) e executalo no editor SQL de Supabase.
#    Cada ficha só se actualiza se updated_at non cambiou; RETURNING devolve as actualizadas.
```

Xera `mapa_nomes_*.csv` (emparellamento de nomes do Excel a `PROVINCIA|NOME`), `informe_*.csv` (antes/despois por clave) e `informe_*.md` (resumo, distribución de estados e dúbidas).

**Regras do estado xeral** (gaña a primeira que se cumpra):
1. «Cargado GDB» = Si → **Cargado na GDB**
2. Campo «Estado campo» = Feito ou «Comprobado campo» = Si → **Campo pechado**
3. Campo en curso ou con «Data campo» → **En campo**
4. Fila en Campo con KMZ/data de preparación → **KMZ preparado**
5. Envío con «Localizable?» = Non… → **Info non localizable**
6. «Activo» = Non (retirado ou sen tractor) → **Sen tractor**
7. «Activo» = Si sen nada do anterior → **Sen info**

As fichas ocultas (fusionadas) sáltanse.

**Regra das notas** (substitúen a «notas de control»):
- **Nota de campo** (`notaCampo`): as «Notas» da folla Campo, e os textos da folla Concellos que falan de campo (campo, visita, KMZ/KML, pins, liñas, tramos, GDB, capataz, horas…).
- **Nota de chamadas** (`notaChamadas`): «Seguinte acción» e observacións sobre contacto (correo, reclamar, chamar, teléfono, WhatsApp, recado, contactar…).
- Se un texto ten palabras dos dous tipos, vai a campo cando fala de visita; se non, a chamadas. «Seguinte acción» sen palabras clave vai a chamadas; «Observacións» sen palabras clave, a campo. Prefixos: «Seguinte acción: », «Obs.: ».

**Importación feita o 11/11/2026**: 63 fichas; estados (sen contar a oculta): Sen info 46 · Sen tractor 8 · KMZ preparado 7 · Campo pechado 1. Crecente: acta asinada (`actaAsinada` e `firmada` = Si; acta en ActasEntrega\FirmadasConcello\02_Pontevedra\Crecente).

**Copia de seguranza** antes de importar: táboa `seaga_backup_20261111` en Supabase (63 filas, RLS sen políticas = pechada) e JSON fóra do repositorio.

## v3.3 (12/11/2026)

**Ortofoto.** A capa é a PNOA máxima actualidade do IGN (WMTS `https://www.ign.es/wmts/pnoa-ma`, capa `OI.OrthoimageCoverage`, GoogleMapsCompatible). O servizo funciona (200, image/jpeg, CORS `*`). Cambios:
- O fondo alternativo automático xa non se garda como preferencia (na v3.2 un fallo puntual de teselas deixaba o dispositivo para sempre en «Mapa base sinxelo»). A preferencia vai agora na clave `cb-base33`, así que todos os dispositivos volven arrancar coa ortofoto.
- Se o WMTS falla, próbase primeiro o WMS oficial `https://www.ign.es/wms-inspire/pnoa-ma` (mesma ortofoto) e só despois o mapa sinxelo.
- As cores dos concellos esvaécense ao achegarse (e o concello seleccionado queda case transparente) para que se vexa a imaxe.

**Ficha do concello.**
- **Control**: só marcas e o estado xeral (fases KMZ preparado / En campo / Campo pechado / Cargado na GDB, que cambian `estadoXeral`; Excel para o compañeiro; acta enviada; acta asinada).
- **Visitas**: datos do KMZ e km (preparados, tramos, feitos, non feitos), notas de campo con data e historial de visitas.
- **Chamadas** (separador novo): notas de chamadas e correos con data, e os contactos co seu historial (antes en Información).
- Non cambia ningunha clave: todo segue gardándose en `change` coa comprobación de `updated_at`.

## v3.4 (12/11/2026)

**Horas do tractor nas visitas** (clave existente `visits[].horas`, sen claves novas):
- Na nota de campo, ao marcar «Rexistrar tamén no historial de visitas», aparece «Horas do tractor (h)» (opcional). Gárdase na visita nova co formato dos datos existentes, p. ex. `5807 h` (`5807,5` → `5807,5 h`).
- O historial amosa as horas como etiqueta «⏱ 5807 h» xunto á data («— h» se non hai) e, enriba, «Horas última visita» (a visita de data máis recente con horas).
- No modal «+ Visita / Editar» o campo chámase «Horas do tractor (h)» e vai xusto despois da data. Un número sen unidade gárdase como «N h»; se non se cambia, o valor existente non se toca.

**Negreira: o selector de estado da comprobación xa se respecta.** Antes o estado estaba forzado a «Concello visitado, tractor non localizado» e, ao gardar «Visita presencial», a interface volvía á opción anterior (aínda que `change.estadoVisita` se puidese escribir). Agora úsase o valor gardado; se non hai ningún, queda o histórico «non-localizado». A etiqueta da lista («tractor non localizado») só aparece nese estado. Só se escribe a clave existente `estadoVisita` en `change`.
