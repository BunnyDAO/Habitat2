# Docker Rebuild Instructions

Please run the following commands **in sequence**, one after the other:

## Step 1: Stop and remove containers
```bash
docker-compose down
```

## Step 2: Rebuild images without cache
```bash
docker-compose build --no-cache
```

## Step 3: Start containers
```bash
docker-compose up
```

---

**Note:** Execute these commands in the exact order shown above. Wait for each command to complete before running the next one. 