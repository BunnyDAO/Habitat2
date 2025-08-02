FROM node:20

WORKDIR /app

COPY package*.json ./
# Install dependencies with legacy peer deps and force resolution
RUN npm install --legacy-peer-deps && \
    npm install rpc-websockets@7.5.1 --save --legacy-peer-deps && \
    npm dedupe --legacy-peer-deps

COPY . .

RUN npm run build

# Use SERVICE_MODE to select which process to run (api or daemon)
# Defaults to API server
CMD ["sh", "-c", "if [ \"$SERVICE_MODE\" = 'daemon' ]; then npm run start:daemon; else npm start; fi"] 