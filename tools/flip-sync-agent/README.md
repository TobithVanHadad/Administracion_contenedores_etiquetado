# Flip Sync Agent

Conector local para leer carpetas de etiquetas desde Windows y subirlas a Flip sin depender de permisos de SharePoint/Power Automate.

## Uso inicial

1. Copia `config.example.json` como `config.local.json`.
2. Edita `serverUrl`, `user`, `pin` y las carpetas por pedido.
3. Ejecuta:

```powershell
node tools\flip-sync-agent\sync-folder.mjs --config tools\flip-sync-agent\config.local.json
```

Para probar sin subir nada:

```powershell
node tools\flip-sync-agent\sync-folder.mjs --config tools\flip-sync-agent\config.local.json --dry-run
```

Si ya guardaste las carpetas dentro de cada pedido en Flip, puedes usar:

```powershell
node tools\flip-sync-agent\sync-folder.mjs --config tools\flip-sync-agent\config.local.json --use-server-folders
```

## Notas

- Solo procesa `.nlbl`, `.btw`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` y `.pdf`.
- Flip descarta automaticamente archivos sin SKU coincidente en el pedido.
- Esta version sube/copias archivos a Flip para que todos puedan verlos. La version empaquetada como `.exe` puede agregar sincronizacion programada y asistente visual.
