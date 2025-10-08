# syntax=docker/dockerfile:1

##########################
# Builder stage
##########################
FROM rockylinux:9 AS builder

RUN set -eux \
    && dnf -y module reset nodejs \
    && dnf -y module enable nodejs:20 \
    && dnf -y install nodejs git \
    && dnf -y clean all

WORKDIR /app

COPY virtlab-frontend/package*.json ./
COPY virtlab-frontend/scripts ./scripts
RUN npm ci || npm install

COPY virtlab-frontend/ ./
ARG VITE_API_URL=https://virtlab.foos.net
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

##########################
# Development stage
##########################
FROM rockylinux:9 AS dev

RUN set -eux \
    && dnf -y module reset nodejs \
    && dnf -y module enable nodejs:20 \
    && dnf -y install nodejs git \
    && dnf -y clean all

WORKDIR /app
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=${VITE_API_URL}

COPY virtlab-frontend/package*.json ./
COPY virtlab-frontend/scripts ./scripts
RUN npm ci || npm install

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

##########################
# Production runtime stage
##########################
FROM rockylinux:9-minimal AS prod

LABEL maintainer="Brandon Foos <webmaster@foos.net>"
LABEL description="VirtLab frontend served via nginx"

RUN set -eux \
    && microdnf -y update \
    && microdnf -y install nginx && \
    microdnf -y clean all \
    && rm -rf /var/cache/dnf/*

ARG VITE_API_URL=https://virtlab.foos.net
ENV VITE_API_URL=${VITE_API_URL}

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

ENV NODE_ENV=production
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
