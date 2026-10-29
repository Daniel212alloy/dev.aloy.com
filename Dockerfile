FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
ENV PORT=3000 DB_FILE=/data/data.json TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
