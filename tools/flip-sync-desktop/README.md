# Flip Sync Desktop

App Windows para sincronizar carpetas locales de etiquetas con Flip. Es el puente local para computadoras que necesitan leer carpetas de OneDrive, red o disco local y mandar esos archivos al Flip online.

## Que hace

- Carga pedidos desde Flip.
- Permite seleccionar una carpeta por pedido.
- Guarda esa carpeta en Flip.
- Escanea `.nlbl`, `.btw`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` y `.pdf`.
- Sube los archivos por lotes y Flip los relaciona por SKU.
- Sincroniza el Excel maestro de pedidos `Contenedores Orvel Europa.xlsx`.
- Ignora por default las pestanas `MASTER`, `BODEGA`, `DV` y `CAT`.
- Puede sincronizar un pedido, todos los pedidos con carpeta o repetir cada X minutos.
- Usa los usuarios operativos de Flip: Gloria, Cala, Cristobal, compras y almacen.

## Opcion recomendada: portable sin instalar

Abre este archivo con doble click:

```text
tools\flip-sync-desktop\FlipSyncDesktop.cmd
```

No requiere admin ni instalador. Si Windows pregunta, permite ejecutar PowerShell para este archivo.

## Crear acceso directo

Desde PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File tools\flip-sync-desktop\Install-FlipSyncDesktop.ps1
```

Esto copia la app a:

```text
%LOCALAPPDATA%\Programs\FlipSyncDesktop
```

y crea el acceso directo `Flip Sync Desktop` en el escritorio.

## Construir exe opcional

Desde la raiz del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File tools\flip-sync-desktop\build-exe.ps1
```

Salida:

```text
tools\flip-sync-desktop\dist\FlipSyncDesktop.exe
```

Si IT bloquea ejecutables desconocidos, usa la opcion portable `.cmd`.

## Uso

1. Abre `FlipSyncDesktop.cmd` o `FlipSyncDesktop.exe`.
2. Escribe servidor, usuario y PIN.
3. Presiona `Cargar pedidos`.
4. Selecciona un pedido.
5. Presiona `Seleccionar carpeta`.
6. Presiona `Guardar carpeta en Flip`.
7. Presiona `Sincronizar seleccionado`.

## Sincronizar Excel maestro

1. En `Excel maestro de pedidos`, selecciona:

```text
C:\Users\GERARDOGONZALEZ\Desktop\OneDrive - Crevel Europe GmbH\Operations Mexico\Operations Mexico\Contenedores Orvel Europa.xlsx
```

2. Revisa `Valores para pedidos nuevos`.
3. Presiona `Sincronizar Excel`.
4. Para que sea automatico, deja marcado `Auto Excel` y presiona `Iniciar auto`.

Cuando `Auto Excel` esta activo, la app revisa si cambio el archivo. Si no cambio, no vuelve a importar.

La sincronizacion del Excel:

- Crea pedidos nuevos usando el nombre de la pestana.
- Actualiza pedidos existentes por nombre/codigo de pedido.
- Conserva notas, archivos, historial, estatus manuales, impresiones y carpeta de etiquetas.
- Agrega SKUs nuevos.
- Conserva lineas que ya no esten en Excel, salvo que marques `Quitar lineas ausentes del Excel`.

## Cuando instalarla en otras computadoras

No es obligatorio instalarla en todas las computadoras. Si tu computadora ve el Excel y las carpetas compartidas de OneDrive, tu computadora puede ser el puente principal y los demas entran solo a Flip web.

Instalala en otra computadora solo si esa persona tiene carpetas locales que tu computadora no puede ver o si quieres que esa computadora tambien haga sincronizacion automatica.

La configuracion se guarda en:

```text
%APPDATA%\FlipSyncDesktop\config.json
```

## Nota

Este exe no reemplaza Flip web. Es un puente local para leer carpetas de Windows y subir/vincular archivos a la plataforma online.
