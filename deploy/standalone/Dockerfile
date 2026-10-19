FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY deploy/standalone/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY server/backend-api.js ./server/backend-api.js
USER node
EXPOSE 8788
CMD ["node", "server/backend-api.js"]
