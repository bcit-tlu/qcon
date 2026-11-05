# Build stage
FROM node:26.13.0-alpine3.24 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . /app

RUN npm run build


# Release/production
# -perl variant required: the cdn-rewrite initContainer runs perl from this image
FROM nginx/nginx-unprivileged:stable-alpine3.24-perl

LABEL maintainer=courseproduction@bcit.ca
LABEL org.opencontainers.image.source="https://github.com/bcit-tlu/qcon"
LABEL org.opencontainers.image.description="qcon is a browser-based tool to convert, edit, and export question libraries between Word (.docx) and QTI/SCORM (D2L Brightspace) formats."

COPY conf.d/default.conf /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html

COPY --from=builder /app/dist/ ./
