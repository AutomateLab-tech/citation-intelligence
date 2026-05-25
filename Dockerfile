FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --ignore-scripts
COPY src ./src
RUN npx tsc && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY action ./action
USER node
ENTRYPOINT ["node", "dist/index.js"]
