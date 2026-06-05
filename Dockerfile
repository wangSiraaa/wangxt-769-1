FROM node:20-alpine

WORKDIR /app

COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --production

COPY backend/src ./backend/src

COPY frontend/package.json ./frontend/package.json
RUN cd frontend && npm install

COPY frontend/public ./frontend/public
COPY frontend/src ./frontend/src
RUN cd frontend && npm run build

RUN rm -rf frontend/node_modules frontend/src frontend/public

WORKDIR /app/backend

RUN mkdir -p ../data

EXPOSE 3001

CMD ["node", "src/index.js"]
