# Despliegue en Railway + Cloudflare

## Objetivo

Publicar la app sin depender de esta computadora. Railway corre la app y guarda datos en un volumen persistente. Cloudflare solo apunta el dominio/subdominio hacia Railway.

## Railway

1. Subir este proyecto a GitHub.
2. Crear un nuevo proyecto en Railway desde ese repositorio.
3. Crear un volumen persistente para el servicio de la app y montarlo en:

```txt
/data
```

4. Railway expone automaticamente `RAILWAY_VOLUME_MOUNT_PATH` cuando el volumen esta conectado. No dependas de `./data` en produccion: ese path se pierde en cada deploy.

La app ahora se protege en Railway: si no existe `RAILWAY_VOLUME_MOUNT_PATH`, rechaza iniciar la lectura/escritura de pedidos para evitar que se creen datos temporales y luego desaparezcan.

Opcionalmente puedes agregar esta variable si quieres ver/fijar el path manualmente, pero el volumen real debe estar conectado:

```txt
ORVEL_DATA_DIR=/data
```

5. Si Railway muestra errores de permiso al escribir en el volumen, agrega esta variable al servicio:

```txt
RAILWAY_RUN_UID=0
```

6. Railway debe usar:

```txt
npm run build
npm run start
```

La app usa el puerto que Railway entrega en `PORT`.

7. Verificar almacenamiento despues del deploy:

```txt
https://TU-DOMINIO/api/system/storage
```

Debe responder `ok: true` y `mode: "railway-volume"`.

## Cloudflare

1. En Railway, copiar el dominio publico generado.
2. En Cloudflare DNS, crear un CNAME para el subdominio que quieras.
3. El CNAME debe apuntar al dominio de Railway.
4. Mantener proxy naranja activado si quieres usar Cloudflare como frente publico.

## Notas

- No subir `data`, `uploads`, `logs` ni `backups` a GitHub.
- Para piloto, SQLite con volumen persistente funciona bien.
- Para operacion grande o varios procesos escribiendo al mismo tiempo, migrar despues a Postgres + almacenamiento de archivos tipo S3/R2.
