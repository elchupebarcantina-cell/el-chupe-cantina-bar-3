# ---------------------------------------------------------------
#  EL CHUPE - Imagen para publicar el sistema en internet
# ---------------------------------------------------------------
FROM node:22-alpine

# Alpine viene sin zonas horarias. Sin esto el servidor corre en horario
# universal y el corte del dia queda 5 horas corrido respecto a Colombia:
# las ventas de la noche se irian al dia siguiente.
RUN apk add --no-cache tzdata
ENV TZ=America/Bogota

WORKDIR /app

# Primero las dependencias, para aprovechar el cache al reconstruir
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY . .

# La base de datos vive en un disco aparte que no se borra al actualizar.
# Estas rutas deben coincidir con el punto de montaje del volumen.
ENV DB_PATH=/datos/elchupe.db
ENV BACKUP_DIR=/datos/backups
ENV UPLOAD_DIR=/datos/uploads
ENV NODE_ENV=production
ENV TRUST_PROXY=1
ENV PORT=3000

EXPOSE 3000

# Crea o actualiza las tablas y arranca. Es seguro correrlo en cada
# despliegue: las migraciones y los datos base no se duplican.
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
