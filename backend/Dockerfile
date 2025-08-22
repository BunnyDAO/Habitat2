FROM node:20

WORKDIR /app

COPY package*.json ./
# Install dependencies with legacy peer deps for compatibility
RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

# Use SERVICE_MODE to select which process to run (api or daemon)
# Defaults to API server
CMD ["sh", "-c", "if [ \"$SERVICE_MODE\" = 'daemon' ]; then npm run start:daemon; else npm start; fi"] 