FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install
# Install serve BEFORE the memory-heavy build step
RUN npm install -g serve

COPY . .

# Build the production bundle
RUN npm run build

EXPOSE 5173

# Serve the static files
CMD ["serve", "-s", "dist", "-l", "5173"]
