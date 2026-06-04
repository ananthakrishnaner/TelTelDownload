FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Build the production bundle
RUN npm run build

EXPOSE 5173

# Serve the static files using a lightweight busybox httpd server to prevent NPM OOM
CMD ["busybox", "httpd", "-f", "-v", "-p", "5173", "-h", "dist"]
