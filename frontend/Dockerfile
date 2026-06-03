FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Build the production bundle
RUN npm run build

# Install a lightweight static server
RUN npm install -g serve

EXPOSE 5173

# Serve the static files from the dist directory
CMD ["serve", "-s", "dist", "-l", "5173"]
