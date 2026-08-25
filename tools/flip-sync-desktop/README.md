# Flip Sync Desktop

App Windows para sincronizar carpetas locales de etiquetas con Flip. Es el puente local para computadoras que necesitan leer carpetas de OneDrive, red o disco local y mandar esos archivos al Flip online.

## Que hace

- Carga pedidos desde Flip.
- Permite seleccionar una carpeta por pedido.
- Guarda esa carpeta en Flip.
- Escanea `.nlbl`, `.btw`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` y `.pdf`.
- Sube los archivos por lotes y Flip los relaciona por SKU.
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

La configuracion se guarda en:

```text
%APPDATA%\FlipSyncDesktop\config.json
```

## Nota

Este exe no reemplaza Flip web. Es un puente local para leer carpetas de Windows y subir/vincular archivos a la plataforma online.
