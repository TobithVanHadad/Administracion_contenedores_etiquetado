# Despliegue en Railway + Cloudflare

## Objetivo

Publicar la app sin depender de esta computadora. Railway corre la app y guarda datos en un volumen persistente. Cloudflare solo apunta el dominio/subdominio hacia Railway.

## Railway

1. Subir este proyecto a GitHub.
2. Crear un nuevo proyecto en Railway desde ese repositorio.
3. Crear un volumen persistente y montarlo en:

```txt
/data
```

4. Railway expone automaticamente `RAILWAY_VOLUME_MOUNT_PATH` cuando el volumen esta conectado. Opcionalmente puedes agregar esta variable si quieres fijarlo manualmente:

```txt
ORVEL_DATA_DIR=/data
```

5. Railway debe usar:

```txt
npm run build
npm run start
```

La app usa el puerto que Railway entrega en `PORT`.

## Cloudflare

1. En Railway, copiar el dominio publico generado.
2. En Cloudflare DNS, crear un CNAME para el subdominio que quieras.
3. El CNAME debe apuntar al dominio de Railway.
4. Mantener proxy naranja activado si quieres usar Cloudflare como frente publico.

## Notas

- No subir `data`, `uploads`, `logs` ni `backups` a GitHub.
- Para piloto, SQLite con volumen persistente funciona bien.
- Para operacion grande o varios procesos escribiendo al mismo tiempo, migrar despues a Postgres + almacenamiento de archivos tipo S3/R2.
