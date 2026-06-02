# Online Deployment Notes

## Objetivo

Publicar la plataforma para que usuarios de Mexico y Europa puedan consultar y actualizar pedidos desde cualquier red, con datos centralizados y experiencia casi en tiempo real.

## Estado actual

- La app corre en Next.js.
- La base actual es SQLite local en `data/pedidos-piloto.sqlite`.
- Los archivos cargados se guardan localmente en `data/uploads`.
- La sincronizacion actual es por polling desde el navegador.

Esto funciona para piloto local. Para salir de esta computadora sin reescribir todo ahora, la ruta elegida es Railway + volumen persistente. La app ya soporta `ORVEL_DATA_DIR` y `RAILWAY_VOLUME_MOUNT_PATH` para guardar SQLite y uploads fuera del disco temporal.

## Ruta practica actual

1. Subir el repo a GitHub.
2. Desplegar en Railway.
3. Crear un volumen persistente montado en `/data`.
4. Dejar que la app use `RAILWAY_VOLUME_MOUNT_PATH`, o configurar `ORVEL_DATA_DIR=/data`.
5. Conectar Cloudflare con un CNAME al dominio de Railway.

Esta ruta ya no depende de la computadora local. Para una produccion mas grande, conviene migrar despues a PostgreSQL + storage tipo S3/R2.

## Arquitectura recomendada para produccion

1. Hosting de aplicacion Next.js
   - Vercel, Azure App Service, Render, Railway o VPS con Docker.
   - Para empezar rapido, Vercel o Render son los caminos mas simples.

2. Base de datos central
   - Migrar SQLite a PostgreSQL.
   - Opciones comunes: Supabase Postgres, Neon, Azure Database for PostgreSQL o Railway Postgres.

3. Archivos
   - No guardar archivos finales en el disco del servidor.
   - Usar OneDrive/SharePoint, Azure Blob Storage, S3 compatible o Supabase Storage.

4. Tiempo real
   - Opcion inicial: polling cada 3-5 segundos.
   - Opcion formal: Supabase Realtime, WebSockets o Server-Sent Events.

5. Seguridad
   - Usuarios reales con login, no solo PIN.
   - Roles: admin, planning, warehouse, read-only.
   - HTTPS obligatorio.
   - Backups automaticos de base de datos.

## Pasos tecnicos antes de salir a produccion

1. Crear una base PostgreSQL.
2. Cambiar `lib/server-store.ts` para usar PostgreSQL en vez de SQLite.
3. Migrar pedidos existentes desde `data/pedidos-piloto.sqlite`.
4. Mover archivos de `data/uploads` a almacenamiento cloud.
5. Configurar variables de entorno.
6. Publicar app en hosting.
7. Configurar dominio y HTTPS.
8. Probar usuarios desde una red externa.

## Riesgo principal

Publicar la app actual sin migrar base de datos y archivos haria que:

- Los datos dependan de una sola maquina.
- Los archivos se pierdan si cambia el servidor.
- Varias personas editando desde distintos paises puedan tener retrasos o inconsistencias.

Para piloto online se puede usar polling rapido. Para produccion real conviene PostgreSQL + storage cloud + realtime.
